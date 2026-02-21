import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { auth } from "firebase-admin";
import { logger } from "@/lib/logger";
import { COLLECTIONS } from "@/lib/types/firestore";
import { Timestamp } from "firebase-admin/firestore";

// The maximum number of documents to delete in one invocation (Firestore limit is 500 per batch)
const BATCH_LIMIT = 400;

/**
 * Serverless Cron Job: GDPR Right-to-be-Forgotten Enforcer
 * Triggered daily via Vercel Cron.
 * 
 * Rules:
 * 1. Locates all users marked with \`deletedAt\` exactly 30+ days ago.
 * 2. Scrub their PII from Firestore.
 * 3. Destroy their Firebase Identity Authority account.
 */
export async function GET(request: NextRequest) {
    try {
        // Enforce Authorization: Only Vercel cron or explicit admin keys can trigger this
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

        // Pass 2: Destroy Firebase Authentication Identities
        const authService = auth();
        let failedAuthDeletions = 0;

        // FirebaseAuth doesn't super easily support bulk delete inside a transaction, doing it concurrently
        await Promise.allSettled(
            deletedUids.map(async (uid) => {
                try {
                    await authService.deleteUser(uid);
                } catch (e: any) {
                    // It's possible the user was already deleted from Auth manually
                    if (e.code !== "auth/user-not-found") {
                        logger.error(`Failed to delete Auth identity for ${uid}`, e);
                        failedAuthDeletions++;
                    }
                }
            })
        );

        logger.info(`GDPR Sweep Complete: Eradicated ${deletedUids.length} accounts (${failedAuthDeletions} Auth failures).`);

        return NextResponse.json({
            status: "success",
            deletedCount: deletedUids.length,
            authFailures: failedAuthDeletions
        });

    } catch (error: any) {
        logger.error("FATAL: GDPR Sweep Failed", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
