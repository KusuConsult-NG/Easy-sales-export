/**
 * Background Job: Detect and Repair Orphaned Firebase Auth Users
 * 
 * Orphaned users = Users in Firebase Auth but missing Firestore profile
 * This can happen if registration fails between Auth creation and Firestore write
 */

import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from '@/lib/types/firestore';
import type { User as FirestoreUser } from '@/lib/types/firestore';
import { logger } from '@/lib/logger';

interface OrphanedUser {
    uid: string;
    email: string | undefined;
    displayName: string | undefined;
    /**
     * Optional because the auth store's creation time genuinely can be absent.
     * This was `string`, filled from `userRecord.metadata.creationTime` — and
     * `metadata` was not on the shim's user record at all, so that read threw
     * a TypeError at the exact moment the scan found an orphan. Both ends are
     * honest now: the shim always returns a metadata object, and the field it
     * carries is allowed not to be set.
     */
    createdAt: string | undefined;
}

export interface OrphanedScan {
    orphaned: OrphanedUser[];
    /** Firebase Auth accounts actually examined by this call. */
    scanned: number;
    /** True only when Auth ran out of accounts before this call ran out of budget. */
    complete: boolean;
    /** Pass back as `startPageToken` to continue. Null when complete. */
    nextPageToken: string | null;
}

/** listUsers' own per-call ceiling. Asking for more is an error, not a bigger page. */
const AUTH_PAGE_SIZE = 1000;

/**
 * Pages of Auth accounts one request will walk before reporting a partial scan.
 *
 * 10,000 accounts is far more than a repair run should ever need and still
 * finishes inside a request. The point of the bound is that exceeding it is
 * *reported*, which is what the previous version did not do.
 */
const MAX_AUTH_PAGES = 10;

/**
 * Scan Firebase Auth for users without Firestore profiles.
 *
 * IT LOOKED AT THE FIRST 1,000 ACCOUNTS AND CALLED THAT ALL OF THEM
 * -----------------------------------------------------------------
 * This was:
 *
 *     // Get all Auth users
 *     const listUsersResult = await adminAuth.listUsers(1000); // Max 1000 users
 *
 * 1000 is `listUsers`' per-call ceiling, not the size of the user base. The
 * method returns a `pageToken` for the next page and this never read it, so the
 * comment "Get all Auth users" described the intent and the code did something
 * else. Against the 41,105 accounts in the production export, the scan covered
 * roughly 2.4% of them.
 *
 * Nothing said so. `detectOrphanedUsers` returned a plain array, the route
 * returned `{ count: orphanedUsers.length }`, and an admin reading "0 orphaned
 * users" learned that there were none among the first thousand — which is not
 * the question the screen asks. `repairAllOrphanedUsers` inherited it: "repair
 * ALL orphaned users in batch" repaired the ones it had found in that thousand,
 * and reported a total that agreed with itself.
 *
 * This is the shape #190 fixed on four admin queues and fb7e93e6 fixed on the
 * database sweeps: a bounded read presented as a complete one. The rule those
 * settled on is the adapter's own — "reported, never silent" — so the scan is
 * paginated, bounded, and says which of the two it ended on.
 */
export async function detectOrphanedUsers(startPageToken?: string): Promise<OrphanedScan> {
    const orphanedUsers: OrphanedUser[] = [];
    let scanned = 0;
    let pageToken: string | undefined = startPageToken;
    let pagesRead = 0;

    try {
        do {
            const listUsersResult = await adminAuth.listUsers(AUTH_PAGE_SIZE, pageToken);
            pagesRead++;
            scanned += listUsersResult.users.length;

            // Check each user for Firestore profile efficiently in batches of 50
            const chunkSize = 50;
            for (let i = 0; i < listUsersResult.users.length; i += chunkSize) {
                const chunk = listUsersResult.users.slice(i, i + chunkSize);
                const refs = chunk.map(u => db.collection(COLLECTIONS.USERS).doc(u.uid));

                // Fetch up to 50 docs in parallel
                const docs = await db.getAll(...refs);

                docs.forEach((doc: { exists: boolean }, idx: number) => {
                    const userRecord = chunk[idx];
                    if (!doc.exists) {
                        orphanedUsers.push({
                            uid: userRecord.uid,
                            email: userRecord.email,
                            displayName: userRecord.displayName,
                            createdAt: userRecord.metadata.creationTime,
                        });

                        logger.warn('Orphaned user detected', {
                            uid: userRecord.uid,
                            email: userRecord.email,
                        });
                    }
                });
            }

            pageToken = listUsersResult.pageToken;
        } while (pageToken && pagesRead < MAX_AUTH_PAGES);

        const complete = !pageToken;

        if (!complete) {
            logger.warn('Orphaned user scan stopped at the page budget', {
                scanned,
                pagesRead,
                found: orphanedUsers.length,
            });
        }

        return {
            orphaned: orphanedUsers,
            scanned,
            complete,
            nextPageToken: pageToken ?? null,
        };
    } catch (error) {
        logger.error('Failed to detect orphaned users', error);
        throw error;
    }
}

/**
 * Auto-repair a single orphaned user by creating their Firestore profile
 */
export async function repairOrphanedUser(uid: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Get user from Firebase Auth
        const userRecord = await adminAuth.getUser(uid);

        // Check if Firestore profile already exists
        const existingDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
        if (existingDoc.exists) {
            return { success: false, error: 'User already has Firestore profile' };
        }

        // Extract info from Auth record
        const email = userRecord.email || `orphaned-${uid}@temp.local`;
        const fullName = userRecord.displayName || 'User';

        // Gender is NOT guessed.
        //
        // This called inferGenderFromName(fullName) — twelve hard-coded first
        // names, five suffixes, and "Default to male if uncertain" — and wrote
        // the answer to the profile. /api/wave/check-eligibility then reads it:
        //
        //     const isMale = gender?.toLowerCase() === "male";
        //     const isWaveBlocked = isMale && (isNewMaleUser || (!hasWaveRole && !hasWaveReg));
        //
        // WAVE is a women's programme. So a repair guessed a protected
        // attribute from a name, defaulted to the answer that excludes, and
        // locked the user out of a programme they may be entitled to — with
        // nothing on screen to say a guess had been made. Against the actual
        // user base the heuristic is close to a coin toss weighted to male:
        // the pattern list is a dozen names and the ending rule is "-a, -e,
        // -ie, -lyn, -elle".
        //
        // Left unset instead. An unset gender reads as null in the eligibility
        // check, isMale is false, and the user is in exactly the position of
        // anyone else who has not filled it in — which is the truth about what
        // is known. The user sets it in their profile.
        const userProfile: Omit<FirestoreUser, 'createdAt' | 'updatedAt'> = {
            uid,
            fullName,
            email,
            roles: ['general_user'], // Minimal role, user can request more
            // NOT verified.
            //
            // This said `verified: true, // Auto-verify`. A rebuilt profile
            // knows nothing about whether the person ever completed
            // verification — the Auth record it is rebuilt from carries no such
            // claim — so asserting it invents the fact.
            //
            // It does not stop at a cosmetic flag. data-recovery.ts unifies the
            // two spellings:
            //
            //     // 7. Unify Verification Fields
            //     if (userData.verified === true && userData.isVerified !== true) {
            //         updates.isVerified = true;
            //
            // and isVerified is the real one, read in 88 places — the KYC
            // surface, the admin member views, and the "Verified" column of the
            // user CSV export. So a repair granted identity-verified status on
            // the next recovery run.
            //
            // False is the honest answer and the safe one: a user who really
            // was verified re-verifies, which is a nuisance; the other
            // direction hands unverified accounts a status the platform sells
            // trust on.
            verified: false,
        };

        await db.collection(COLLECTIONS.USERS).doc(uid).set({
            ...userProfile,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _repairedAt: FieldValue.serverTimestamp(), // Mark as auto-repaired
            _repairReason: 'orphaned_auth_user',
        }, { merge: true });

        logger.info('Successfully repaired orphaned user', { uid, email });

        return { success: true };
    } catch (error) {
        logger.error('Failed to repair orphaned user', { uid, error });
        return { success: false, error: String(error) };
    }
}

/**
 * Repair the orphaned users found by one scan.
 *
 * Named "ALL" before, and it was not: it repaired whatever
 * detectOrphanedUsers had found in the first 1,000 Auth accounts and returned a
 * `total` that agreed with itself. The scan's own bound is now carried out
 * here — `complete` and `nextPageToken` — so a caller can tell the difference
 * between "there were none left" and "we stopped looking".
 */
export async function repairAllOrphanedUsers(startPageToken?: string): Promise<{
    total: number;
    repaired: number;
    failed: number;
    errors: Array<{ uid: string; error: string }>;
    scanned: number;
    complete: boolean;
    nextPageToken: string | null;
}> {
    const scan = await detectOrphanedUsers(startPageToken);

    const results = {
        total: scan.orphaned.length,
        repaired: 0,
        failed: 0,
        errors: [] as Array<{ uid: string; error: string }>,
        scanned: scan.scanned,
        complete: scan.complete,
        nextPageToken: scan.nextPageToken,
    };

    for (const user of scan.orphaned) {
        const result = await repairOrphanedUser(user.uid);

        if (result.success) {
            results.repaired++;
        } else {
            results.failed++;
            results.errors.push({
                uid: user.uid,
                error: result.error || 'Unknown error',
            });
        }
    }

    logger.info('Batch orphaned user repair completed', results);

    return results;
}

/**
 * inferGenderFromName was removed.
 *
 * It guessed a protected attribute from a name and defaulted to male, and the
 * only caller wrote that guess to the profile that /api/wave/check-eligibility
 * reads to decide access to a women's programme. Deleted rather than left
 * unused, because an available gender-from-name helper is an invitation to the
 * next person who needs a gender and does not have one.
 */

