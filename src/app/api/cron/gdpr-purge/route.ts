export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { COLLECTIONS } from "@/lib/types/firestore";
import { Timestamp } from "@/lib/firestore-compat";
import { purgeChatbotDataOlderThan } from "@/lib/chatbot-db";

// The maximum number of documents to delete in one invocation (Firestore limit is 500 per batch)
const BATCH_LIMIT = 400;

/**
 * Serverless Cron Job: GDPR Right-to-be-Forgotten Enforcer
 * Triggered daily via Railway Cron.
 * 
 * Rules:
 * 1. Locates all users marked with \`deletedAt\` exactly 30+ days ago.
 * 2. Scrub their PII from Firestore.
 * 3. Destroy their Firebase Identity Authority account.
 */
export async function GET(request: NextRequest) {
    try {
        // Enforce Authorization: Only Railway cron or explicit admin keys can trigger this
        const authHeader = request.headers.get("Authorization");
        const cronSecret = process.env.CRON_SECRET;

        // Skip validation only in local dev if CRON_SECRET is not set
        if (process.env.NODE_ENV === "production" || cronSecret) {
            if (authHeader !== `Bearer ${cronSecret}`) {
                logger.warn("Unauthorized attempt to trigger GDPR cron");
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
        }

        logger.info("Initializing GDPR Retention Sweep...");

        // Calculate the timestamp for 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thresholdTimestamp = Timestamp.fromDate(thirtyDaysAgo);

        // 1. Query users marked for deletion older than 30 days
        const usersRef = db.collection(COLLECTIONS.USERS);
        const expiredUsersSnapshot = await usersRef
            .where("deletedAt", "<=", thresholdTimestamp)
            .limit(BATCH_LIMIT)
            .get();

        if (expiredUsersSnapshot.empty) {
            logger.info("GDPR Sweep Complete: No expired accounts found.");
            return NextResponse.json({ status: "success", deletedCount: 0, message: "No expired accounts found." });
        }

        const batch = db.batch();
        const deletedUids: string[] = [];

        for (const doc of expiredUsersSnapshot.docs) {
            const uid = doc.id;

            // Queue Firestore PII Deletion
            batch.delete(doc.ref);

            // Queue Cooperative Memberships Deletion
            const coopRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(uid);
            batch.delete(coopRef);

            // Note: We leave financial transactions and export windows intact 
            // for absolute legal ledger integrity, but they are now detached from PII 
            // as the user document holding names/banks is destroyed.

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

        logger.info(`GDPR Sweep Complete: Eradicated ${deletedUids.length} accounts (${failedAuthDeletions} Auth failures).`);

        // Phase 13: Purge chatbot sessions/messages older than 90 days (non-blocking)
        purgeChatbotDataOlderThan(90)
            .then(count => logger.info(`GDPR Chatbot Purge: Removed ${count} old sessions.`))
            .catch(err => logger.error("GDPR Chatbot Purge failed (non-fatal):", err));

        return NextResponse.json({
            status: "success",
            deletedCount: deletedUids.length,
            authDeletionEnabled,
            authFailures: failedAuthDeletions
        });

    } catch (error: any) {
        logger.error("FATAL: GDPR Sweep Failed", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
