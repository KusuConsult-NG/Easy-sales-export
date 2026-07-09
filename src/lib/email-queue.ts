
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";

interface EmailData {
    to: string;
    subject: string;
    message: string; // HTML content
    metadata?: Record<string, any>;
}

/**
 * Queue Email Utility
 * 
 * Attempts to send an email immediately via Resend.
 * If it fails (rate limit, network error, etc.), it saves the email
 * to the `email_queue` collection in Firestore for later processing.
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
 * Internal helper to save to Firestore
 */
async function saveToQueue(data: EmailData, lastError: string) {
    try {
        await db.collection(COLLECTIONS.EMAIL_QUEUE).add({
            to: data.to,
            subject: data.subject,
            message: data.message,
            metadata: data.metadata || {},
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
