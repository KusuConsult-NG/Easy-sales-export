
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";

export interface EmailData {
    to: string;
    subject: string;
    message: string; // HTML content
    metadata?: Record<string, any>;
    /**
     * #394. The queue row carries the sender and the reply-to, so a retry
     * delivers the same email that failed rather than a subtly different one:
     * an academy decision retried as the platform default, or a contact-form
     * reply that no longer goes back to the person who wrote in.
     */
    from?: string;
    replyTo?: string;
}

/**
 * Queue Email Utility
 * 
 * Attempts to send an email immediately via Resend.
 * If it fails (rate limit, network error, etc.), it saves the email
 * to the `email_queue` collection in Firestore for later processing.
 */
/**
 * #393. THIS EXPORT HAS NO CALLER, AND THAT IS THE OUTCOME OF #354 RATHER THAN
 * AN OVERSIGHT — recorded so nobody wires it and ends up with two producers.
 *
 * #354 found this function unreferenced: "send now, and save to the queue if
 * that fails", with nothing calling it, so EMAIL_QUEUE was never written while
 * a cron drained it on a schedule. The repair did NOT wire this up. It wired
 * saveToQueue — the private half — into sendEmailNotification, which is where
 * the typed senders already funnel, so every one of them gained the retry at
 * once instead of nineteen call sites being changed to use this.
 *
 * What is left here is the standalone form: useful to a caller that is not one
 * of the typed senders and wants send-then-queue in one call. Nothing is today.
 */
export async function queueEmail(data: EmailData): Promise<{ success: boolean; queued: boolean; error?: string }> {
    try {
        // 1. Check Config
        if (!process.env.RESEND_API_KEY) {
            console.error('[EMAIL QUEUE] RESEND_API_KEY not configured');
            // If no key, we can't send. Queueing might be futile if it's a permanent config issue,
            // but let's queue it anyway just in case the key is added later.
            await saveToQueue(data, "config_missing");
            return { success: false, queued: true, error: "Email service not configured. Queued." };
        }

        // 2. Initial Send Attempt
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const senderEmail = process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>';

        try {
            const result = await resend.emails.send({
                from: senderEmail,
                to: data.to,
                subject: data.subject,
                html: data.message,
                tags: data.metadata ? [
                    { name: 'type', value: data.metadata.type || 'general' }
                ] : undefined,
            });

            if (result.error) {
                throw new Error(result.error.message);
            }

            // Success
            return { success: true, queued: false };

        } catch (sendError: any) {
            console.warn('[EMAIL QUEUE] Direct send failed, queuing:', sendError.message);
            // 3. Fallback: Save to Queue
            await saveToQueue(data, sendError.message);
            return { success: false, queued: true, error: sendError.message };
        }

    } catch (error: any) {
        // Top-level error (e.g. import failed, db failed)
        console.error('[EMAIL QUEUE] Critical failure:', error);
        // If we can't even save to DB, we are in trouble.
        // Try to save to DB one last time if the error wasn't DB related
        try {
            await saveToQueue(data, error.message);
            return { success: false, queued: true, error: error.message };
        } catch (dbError) {
            return { success: false, queued: false, error: "Critical: Failed to send AND failed to queue." };
        }
    }
}

/**
 * Put one email on the retry queue.
 *
 *   #354 EXPORTED. It used to be private to queueEmail, and queueEmail had no
 *        callers — so the only writer of COLLECTIONS.EMAIL_QUEUE was
 *        unreachable and the cron that drains it ran against an empty
 *        collection forever. sendEmailNotification, the sender the whole
 *        application actually uses, now calls this when a send fails.
 *
 *        The row shape is the cron's contract: status "pending" and a
 *        `nextRetry` it selects on. Both are set so the next run picks it up.
 */
export async function saveToQueue(data: EmailData, lastError: string) {
    try {
        await db.collection(COLLECTIONS.EMAIL_QUEUE).add({
            to: data.to,
            subject: data.subject,
            message: data.message,
            metadata: data.metadata || {},
            from: data.from ?? null,
            replyTo: data.replyTo ?? null,
            status: "pending",
            attempts: 1,
            lastError: lastError,
            createdAt: FieldValue.serverTimestamp(),
            nextRetry: FieldValue.serverTimestamp(), // Ready immediately for next cron
        });
        console.log(`[EMAIL QUEUE] Saved email to ${data.to} in queue.`);
    } catch (e) {
        console.error("[EMAIL QUEUE] Failed to save to Firestore:", e);
        throw e;
    }
}
