export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { COLLECTIONS } from "@/lib/types/firestore";
import { Timestamp, FieldValue } from "@/lib/firestore-compat";
import { userErasurePatch, erasureRetentionRecord, erasedOwnerMarker } from "@/lib/user-erasure";
import { purgeChatbotDataOlderThan } from "@/lib/chatbot-db";

// The maximum number of accounts scrubbed in one invocation. Each account
// writes three documents (retention record, user row, membership row), so this
// stays well inside a single batch.
const BATCH_LIMIT = 400;

/**
 * Serverless Cron Job: GDPR Right-to-be-Forgotten Enforcer
 * Triggered daily via Railway Cron.
 * 
 * Rules:
 * 1. Locates users marked with \`deletedAt\` 30+ days ago that it has not
 *    already swept.
 * 2. Scrubs their PII in place, using the shared erasure definition. NOTHING IS
 *    DELETED — see the note in the loop, and #327.
 * 3. Optionally destroys the auth identity, behind GDPR_PURGE_DELETE_AUTH.
 */
export async function GET(request: NextRequest) {
    try {
        // Enforce Authorization: Only Railway cron or explicit admin keys can trigger this
        const authHeader = request.headers.get("Authorization");
        const cronSecret = process.env.CRON_SECRET;

        // WHAT WAS WRONG HERE
        // -------------------
        // The gate read "validate in production, or whenever a secret exists",
        // which sounds safe and is not. With CRON_SECRET unset in production it
        // still entered the branch — and compared against the literal string
        // "Bearer undefined", which any caller can send.
        //
        // This route DELETES user accounts and scrubs PII. It is the last route
        // in the codebase that should have an accidental public trigger.
        //
        // No secret now means no run, in every environment. A destructive job
        // that cannot authenticate its caller must not guess.
        if (!cronSecret) {
            logger.error("[gdpr-purge] CRON_SECRET is not configured; refusing to run");
            return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
        }

        if (authHeader !== `Bearer ${cronSecret}`) {
            logger.warn("Unauthorized attempt to trigger GDPR cron");
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        logger.info("Initializing GDPR Retention Sweep...");

        // Calculate the timestamp for 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thresholdTimestamp = Timestamp.fromDate(thirtyDaysAgo);

        // 1. Query users marked for deletion older than 30 days, not yet swept.
        //
        // `gdprPurgedAt == null` is what keeps a row from being re-selected
        // every day now that the sweep scrubs instead of deleting. The adapter
        // maps `== null` to an `is null` check on `raw_data->>'gdprPurgedAt'`,
        // and a JSONB `->>` on a missing key yields SQL NULL, so a row that has
        // never been swept matches and a swept one drops out.
        const usersRef = db.collection(COLLECTIONS.USERS);
        const expiredUsersSnapshot = await usersRef
            .where("deletedAt", "<=", thresholdTimestamp)
            .where("gdprPurgedAt", "==", null)
            .limit(BATCH_LIMIT)
            .get();

        if (expiredUsersSnapshot.empty) {
            logger.info("GDPR Sweep Complete: No expired accounts found.");
            return NextResponse.json({ status: "success", erasedCount: 0, message: "No expired accounts found." });
        }

        const batch = db.batch();
        const deletedUids: string[] = [];

        /**
         * THE SWEEP DESTROYED ROWS THE PLATFORM'S OWN ERASURE MODULE RETIRES — #327.
         *
         * This was:
         *
         *     batch.delete(doc.ref);                                  // USERS
         *     batch.delete(db.collection(COOPERATIVE_MEMBERS).doc(uid));
         *
         * with the note "we leave financial transactions and export windows
         * intact for absolute legal ledger integrity, but they are now detached
         * from PII as the user document holding names/banks is destroyed."
         *
         * The reference erasure path — actions/user.ts, built by #283/#300/#305
         * — deletes nothing. It scrubs the user row with userErasurePatch, marks
         * the related rows with erasedOwnerMarker, and writes an
         * ERASURE_RETENTION record. Its own comment says why the row survives:
         * "We retain the UID so that database foreign keys (like 'sellerId' on
         * an order or 'buyerId' on a farm purchase) do not break."
         *
         * This cron then destroyed exactly that row thirty days later. So the
         * thing the erasure path deliberately retained was removed by the job
         * that runs after it, and the ledger it claims to keep "intact" was left
         * pointing at nothing. `update()` on a missing document is a documented
         * silent no-op on this adapter, which is the whole reason #300 moved
         * erasure off deletion.
         *
         * The cooperative membership row is worse: it holds the member's savings
         * and locked balances, and #319 established that the export payout looks
         * that row up by user id. Destroying it turns a pending return into an
         * unpayable one. The self-service path REFUSES erasure while those
         * balances are non-zero; this job checked nothing and deleted anyway.
         *
         * Scrubbing is what makes this GDPR-compliant, not destruction — and it
         * is the owner's standing instruction for this codebase: fix the errors,
         * keep the data safe. Nothing here removes a row.
         *
         * userErasurePatch is idempotent, so a row already scrubbed by the
         * self-service path is unharmed by being scrubbed again.
         */
        for (const doc of expiredUsersSnapshot.docs) {
            const uid = doc.id;

            // The index of this person's uploaded documents and their email at
            // erasure — server-only, and the only record of whose the Cloudinary
            // assets were. Written before the user row loses them. merge:true so
            // a record the self-service path already wrote is not overwritten
            // with nulls from an already-scrubbed row.
            batch.set(
                db.collection(COLLECTIONS.ERASURE_RETENTION).doc(uid),
                erasureRetentionRecord(uid, doc.data()),
                { merge: true },
            );

            batch.update(doc.ref, {
                ...userErasurePatch(uid),
                deleted: true,
                // The field lib/auth.ts refuses to log in on.
                suspended: true,
                gdprPurgedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Retired, not destroyed — the same marker actions/user.ts applies
            // to the wallet and the seller verification. The balances stay
            // readable so a payout owed to this member can still be found.
            const coopRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(uid);
            batch.set(coopRef, {
                ...erasedOwnerMarker(uid),
                // The membership row carries a name, phone, email and next of
                // kin whenever an admin has edited it — /admin/cooperatives/members
                // writes exactly those fields onto it. The shared definition is
                // applied here too rather than a second hand-written list, which
                // is how #283's omission happened in the first place.
                ...userErasurePatch(uid),
            }, { merge: true });

            // Financial transactions and export windows are left intact for
            // ledger integrity, and now genuinely are: the user row they point
            // at still exists, scrubbed.

            deletedUids.push(uid);
        }

        // Execute Firestore Batch Delete
        await batch.commit();

        // Pass 2: Destroy Authentication Identities.
        //
        // This previously called auth() from firebase-admin, which resolves to
        // the local shim exporting `auth: () => ({})`. deleteUser was therefore
        // undefined and threw a TypeError for every user; the catch only
        // recognised Firebase's "auth/user-not-found" code, so a TypeError was
        // counted as a failure and swallowed. The result was that PII rows were
        // deleted while the auth identity — holding the user's email — survived
        // indefinitely, and the route still returned HTTP 200.
        // SAFETY GATE — read this before enabling.
        //
        // Because auth deletion has never actually worked, `auth.users` still
        // holds the email, id, created_at and user_metadata of every account
        // this cron has ever "purged". That orphaned auth data is currently the
        // best available source for reconstructing deleted user records.
        //
        // Repairing the deletion therefore destroys the recovery source on the
        // next run. It stays off until GDPR_PURGE_DELETE_AUTH=true is set
        // explicitly, so identity data can be exported first. The sweep still
        // reports exactly what it would remove.
        const authDeletionEnabled = process.env.GDPR_PURGE_DELETE_AUTH === "true";
        let failedAuthDeletions = 0;

        if (!authDeletionEnabled) {
            logger.warn(
                `GDPR Sweep: auth deletion disabled (GDPR_PURGE_DELETE_AUTH is not "true"). ` +
                `${deletedUids.length} auth identities left intact: ${deletedUids.join(", ")}`
            );
        } else {
            await Promise.allSettled(
                deletedUids.map(async (uid) => {
                    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
                    if (error) {
                        // Already removed from Auth (manually or by a previous run) is not a failure.
                        const alreadyGone = error.status === 404 || /not.?found/i.test(error.message || "");
                        if (!alreadyGone) {
                            logger.error(`Failed to delete Auth identity for ${uid}`, error);
                            failedAuthDeletions++;
                        }
                    }
                })
            );
        }

        logger.info(`GDPR Sweep Complete: Scrubbed ${deletedUids.length} accounts, no rows removed (${failedAuthDeletions} Auth failures).`);

        // Phase 13: Purge chatbot sessions/messages older than 90 days (non-blocking)
        purgeChatbotDataOlderThan(90)
            .then(count => logger.info(`GDPR Chatbot Purge: Removed ${count} old sessions.`))
            .catch(err => logger.error("GDPR Chatbot Purge failed (non-fatal):", err));

        return NextResponse.json({
            status: "success",
            // `deletedCount` was the name while this destroyed rows. It scrubs
            // them now, and a field called "deleted" would have an operator
            // believe records were removed when they were retained.
            erasedCount: deletedUids.length,
            authDeletionEnabled,
            authFailures: failedAuthDeletions
        });

    } catch (error: any) {
        logger.error("FATAL: GDPR Sweep Failed", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
