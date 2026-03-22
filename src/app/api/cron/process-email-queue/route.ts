
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Extend timeout for processing

/**
 * Cron Job: Process Email Queue
 * 
 * Retries sending emails that failed previously.
 * Schedule: Every 10 minutes (configurable in vercel.json)
 */
export async function GET(request: Request) {
    // Check Authorization (Vercel Cron Header)
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        logger.info("[CRON] Starting Email Queue Processing...");
        const now = new Date();

        // Fetch Pending Emails ready for retry
        const snapshot = await db.collection(COLLECTIONS.EMAIL_QUEUE)
            .where("status", "==", "pending")
            .where("nextRetry", "<=", now)
            .limit(10) // Process in small batches
            .get();

        if (snapshot.empty) {
            logger.info("[CRON] No pending emails found.");
            return NextResponse.json({ success: true, processed: 0 });
        }

        logger.info(`[CRON] Found ${snapshot.size} emails to retry.`);

        // Setup Resend
        if (!process.env.RESEND_API_KEY) {
            logger.error('[CRON] RESEND_API_KEY missing, skipping processing.');
            return NextResponse.json({ success: false, error: "Configuration missing" }, { status: 500 });
        }
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const senderEmail = process.env.EMAIL_FROM || 'Easy Sales Export <noreply@easysalesexport.com>';

        let processedCount = 0;
        let successCount = 0;
        let failCount = 0;

        // Process Loop
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const attempts = data.attempts || 1;
            const maxAttempts = 5; // Give it 5 tries

            try {
                // Attempt Send
                const result = await resend.emails.send({
                    from: senderEmail,
                    to: data.to,
                    subject: data.subject,
                    html: data.message,
                    tags: data.metadata ? [
                        { name: 'type', value: data.metadata.type || 'retry' }
                    ] : undefined,
                });

                if (result.error) {
                    throw new Error(result.error.message);
                }

                // Success: Delete or Mark Complete
                // We'll delete to keep collection clean, or move to 'sent_log' if audit needed.
                // For resilience, let's just delete the queue item.
                await db.collection(COLLECTIONS.EMAIL_QUEUE).doc(doc.id).delete();
                logger.info(`[CRON] Successfully sent email to ${data.to} (ID: ${doc.id})`);
                successCount++;

            } catch (error: any) {
                logger.error(`[CRON] Failed to send email (ID: ${doc.id}):`, error.message);
                failCount++;

                // Handle Check for Max Attempts
                if (attempts >= maxAttempts) {
                    // Mark as DEAD LETTER (failed permanently)
                    await db.collection(COLLECTIONS.EMAIL_QUEUE).doc(doc.id).update({
                        status: "failed",
                        lastError: error.message,
                        failedAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    logger.info(`[CRON] Email (ID: ${doc.id}) marked as FAILED after ${attempts} attempts.`);
                } else {
                    // Backoff (Exponential: 5m, 15m, 45m, etc.)
                    // attempts starts at 1. next retry logic:
                    // 1 -> 5 min
                    // 2 -> 15 min
                    // 3 -> 60 min
                    const backoffMinutes = Math.pow(3, attempts) * 5; // 15, 45, 135... rough.
                    // simpler: just add 15 mins
                    const nextRetry = new Date();
                    nextRetry.setMinutes(nextRetry.getMinutes() + 15); // Fixed 15m backoff for simplicity

                    await db.collection(COLLECTIONS.EMAIL_QUEUE).doc(doc.id).update({
                        attempts: FieldValue.increment(1),
                        lastError: error.message,
                        nextRetry: nextRetry,
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    logger.info(`[CRON] Email (ID: ${doc.id}) re-queued. Next retry in 15m.`);
                }
            }
            processedCount++;
        }

        return NextResponse.json({
            success: true,
            processed: processedCount,
            succeeded: successCount,
            failed: failCount
        });

    } catch (error: any) {
        logger.error("[CRON] processing error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
