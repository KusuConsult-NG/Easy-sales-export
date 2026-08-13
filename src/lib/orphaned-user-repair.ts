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
    createdAt: string;
}

/**
 * Scan Firebase Auth for users without Firestore profiles
 */
export async function detectOrphanedUsers(): Promise<OrphanedUser[]> {
    const orphanedUsers: OrphanedUser[] = [];

    try {
        // Get all Auth users
        const listUsersResult = await adminAuth.listUsers(1000); // Max 1000 users

        // Check each user for Firestore profile efficiently in batches of 50
        const chunkSize = 50;
        for (let i = 0; i < listUsersResult.users.length; i += chunkSize) {
            const chunk = listUsersResult.users.slice(i, i + chunkSize);
            const refs = chunk.map(u => db.collection(COLLECTIONS.USERS).doc(u.uid));
            
            // Fetch up to 50 docs in parallel
            const docs = await db.getAll(...refs);
            
            docs.forEach((doc, idx) => {
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

        return orphanedUsers;
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
 * Repair ALL orphaned users in batch
 */
export async function repairAllOrphanedUsers(): Promise<{
    total: number;
    repaired: number;
    failed: number;
    errors: Array<{ uid: string; error: string }>;
}> {
    const orphanedUsers = await detectOrphanedUsers();

    const results = {
        total: orphanedUsers.length,
        repaired: 0,
        failed: 0,
        errors: [] as Array<{ uid: string; error: string }>,
    };

    for (const user of orphanedUsers) {
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

