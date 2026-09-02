
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { NextResponse } from "next/server";
import { claimStatusTransition } from "@/lib/status-transition";

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
    const CRON_SECRET = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    if (!CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    if (authHeader !== `Bearer ${CRON_SECRET}`) return new NextResponse('Unauthorized', { status: 401 });

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
        const senderEmail = process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>';

        let processedCount = 0;
        let successCount = 0;
        let failCount = 0;
        // Rows another run had already claimed.
        let skippedCount = 0;
        // Rows whose email WENT OUT but could not be recorded — flagged for a
        // human, never retried. Counted apart from `failed` because they are
        // the opposite situation.
        let unrecordedCount = 0;

        // Process Loop
        for (const doc of snapshot.docs) {
            const data = doc.data();
            // Was `data.attempts || 1`, compared with `attempts >= maxAttempts`.
            // A row that has never been tried reads 1, so the fifth failure sees
            // 4 and re-queues, and the row is only retired on the SIXTH. Counting
            // the attempt about to happen makes "5 tries" mean five.
            const attempts = Number(data.attempts) || 0;
            const maxAttempts = 5; // Give it 5 tries

            /**
             * CLAIM THE ROW BEFORE SENDING — #326.
             *
             * The loop selected `status == "pending"` and sent, with no claim in
             * between. Two overlapping runs — a slow Resend call against a
             * ten-minute schedule, or a manual trigger landing on top of a
             * scheduled one — both read the same pending rows and both sent. The
             * recipient got the email twice.
             *
             * Every other loop in this codebase was moved onto
             * claimStatusTransition for exactly this, #249–#251, including two
             * loops in the sibling release-escrow cron. This queue was missed
             * because nothing it duplicates is money — but a member getting two
             * copies of the same loan decision is still the platform speaking
             * twice.
             *
             * The claim also fixes the send-succeeded-record-failed case below:
             * the row is already out of `pending` before Resend is called, so a
             * later failure cannot put it back in front of another run.
             */
            const claim = await claimStatusTransition({
                collection: COLLECTIONS.EMAIL_QUEUE,
                id: doc.id,
                from: "pending",
                to: "sending",
                patch: { claimedAt: new Date().toISOString() },
            });

            if (!claim.claimed) {
                logger.info(`[CRON] Email ${doc.id} is '${claim.status ?? "gone"}', not 'pending' — another run has it.`);
                skippedCount++;
                continue;
            }

            // Whether the message actually left. Distinguishes "the send failed"
            // from "the send worked and only the bookkeeping failed", which are
            // opposite situations that the single catch below used to conflate.
            let delivered = false;

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

                // Past this line the message has left the building.
                delivered = true;

                /**
                 *   #303 THE QUEUE KEPT ITS FAILURES AND DESTROYED ITS
                 *        SUCCESSES — exactly backwards.
                 *
                 *        A permanent failure is marked `status: "failed"` with
                 *        the error and a timestamp, and stays. A SUCCESS was
                 *        deleted. So the only question this collection could
                 *        answer was "what never went out"; "was the member's
                 *        loan approval ever emailed, and when" had no record at
                 *        all.
                 *
                 *        The code was undecided about it in writing: "We'll
                 *        delete to keep collection clean, or move to 'sent_log'
                 *        if audit needed. For resilience, let's just delete the
                 *        queue item." Deleting is not what makes it resilient —
                 *        leaving the pending query alone is, and `status` does
                 *        that. The processor selects status == "pending", so a
                 *        sent row drops out of the loop without being destroyed.
                 */
                await db.collection(COLLECTIONS.EMAIL_QUEUE).doc(doc.id).update({
                    status: "sent",
                    sentAt: FieldValue.serverTimestamp(),
                    providerMessageId: result.data?.id ?? null,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                logger.info(`[CRON] Successfully sent email to ${data.to} (ID: ${doc.id})`);
                successCount++;

            } catch (error: any) {
                // THE EMAIL WENT OUT AND ONLY THE RECORD FAILED — #326.
                //
                // The status update sits inside this try, so a database hiccup
                // AFTER a successful send landed here and was treated as a send
                // failure: attempts incremented, row re-queued, and the next run
                // sent the member the same email again. It was also counted as
                // a failure in the report, so the one number an operator would
                // check said the opposite of what happened.
                //
                // #258/#259 and #318's shape — the side effect happened, the
                // record did not — on the queue that exists to prevent exactly
                // that.
                //
                // The row stays in "sending", which is outside the pending
                // query, so it is never re-sent. That is the safe direction: a
                // stuck row is visible and fixable, a duplicate email is not
                // recallable.
                if (delivered) {
                    logger.error(
                        `[CRON] Email ${doc.id} WAS SENT but could not be recorded — left 'sending', not retried:`,
                        error.message,
                    );
                    await db.collection(COLLECTIONS.EMAIL_QUEUE).doc(doc.id).update({
                        lastError: `Delivered but not recorded: ${error.message}`,
                        needsReconciliation: true,
                        needsReconciliationAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp(),
                    }).catch((e: any) => logger.error(`[CRON] Could not flag ${doc.id}:`, e?.message));
                    unrecordedCount++;
                    processedCount++;
                    continue;
                }

                logger.error(`[CRON] Failed to send email (ID: ${doc.id}):`, error.message);
                failCount++;

                // Handle Check for Max Attempts. `attempts` counts tries BEFORE
                // this one, so the attempt that just failed is attempts + 1.
                if (attempts + 1 >= maxAttempts) {
                    // Mark as DEAD LETTER (failed permanently)
                    await db.collection(COLLECTIONS.EMAIL_QUEUE).doc(doc.id).update({
                        status: "failed",
                        lastError: error.message,
                        failedAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    logger.info(`[CRON] Email (ID: ${doc.id}) marked as FAILED after ${attempts + 1} attempts.`);
                } else {
                    // The backoff was COMPUTED AND THROWN AWAY — #326.
                    //
                    // `backoffMinutes` was assigned from Math.pow(3, attempts) * 5
                    // and then never read; the line under it built a fixed 15
                    // minutes instead, with the comment "simpler". So the block
                    // documented an exponential backoff — 5m, 15m, 45m — that
                    // did not happen, and a dead address was hammered every
                    // fifteen minutes for the life of the row.
                    //
                    // The computed value is now the one used, which is what both
                    // the variable and the comment above always said.
                    const backoffMinutes = Math.min(Math.pow(3, attempts) * 5, 24 * 60);
                    const nextRetry = new Date();
                    nextRetry.setMinutes(nextRetry.getMinutes() + backoffMinutes);

                    // Back to "pending" — the claim above moved it to "sending",
                    // and a row left there is invisible to the next run.
                    await db.collection(COLLECTIONS.EMAIL_QUEUE).doc(doc.id).update({
                        status: "pending",
                        attempts: FieldValue.increment(1),
                        lastError: error.message,
                        nextRetry: nextRetry,
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    logger.info(`[CRON] Email (ID: ${doc.id}) re-queued. Next retry in ${backoffMinutes}m.`);
                }
            }
            processedCount++;
        }

        return NextResponse.json({
            success: true,
            processed: processedCount,
            succeeded: successCount,
            failed: failCount,
            skipped: skippedCount,
            unrecorded: unrecordedCount,
            ...(unrecordedCount > 0
                ? { warning: "some emails were delivered but not recorded — see status 'sending' with needsReconciliation" }
                : {}),
        });

    } catch (error: any) {
        logger.error("[CRON] processing error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
