"use server";

import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from 'firebase-admin/firestore';
import { serializeDocs } from '@/lib/firestore-serialize';
import { communicationsService } from '@/services';

import { ActionResponse } from '@/lib/safe-action';

/**
 * Get recipient emails based on segment
 */
async function getRecipientEmails(segment: string): Promise<string[]> {
    logger.info(`[AdminComms] getRecipientEmails called with segment: '${segment}'`);
    try {
        return await communicationsService.getTargetedUsers(segment);
    } catch (error) {
        logger.error('[AdminComms] ERROR in getRecipientEmails:', error);
        return [];
    }
}

/**
 * Send bulk email to users
 * Accepts recipients segment, subject, and HTML body
 */
export async function sendBulkEmailAction(prevState: ActionResponse<unknown>, formData: FormData): Promise<ActionResponse<{ recipientCount: number }>> { const adminCheck = await requireAdmin();
    if ("error" in adminCheck) return { success: false as const, error: "Unauthorized: admin role required", data: null };
    try {
        const recipients = (formData.get('recipients') as string | null)?.trim() ?? "";
        const subject = (formData.get('subject') as string | null)?.trim() ?? "";
        const body = (formData.get('body') as string | null)?.trim() ?? "";

        logger.info(`[AdminComms] sendBulkEmailAction — recipients: '${recipients}', subject: '${subject?.substring(0, 50)}', body length: ${body?.length || 0}`);

        if (!recipients || !subject || !body) { return { success: false as const, error: 'All fields are required', data: null };
        }

        // Get recipient emails
        const emails = await getRecipientEmails(recipients);

        if (emails.length === 0) { return { success: false as const, error: 'No recipients found for this segment', data: null };
        }

        // Send email via Resend
        // Note: Resend basic tier has limits. For production bulk email, consider batching or a different provider.
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Batch sending to avoid hitting limits
        const fromAddress = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'Easy Sales Export <info@easysalesexport.com>';

        const CHUNK_SIZE = 100;
        let successfulSends = 0;
        let hasError = false;
        let lastError = '';

        for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
            const chunk = emails.slice(i, i + CHUNK_SIZE);
            const batchPayload = chunk.map(email => ({
                from: `Easy Sales Export <${fromAddress}>`,
                to: email,
                subject: subject,
                html: body
            }));

            const { error } = await resend.batch.send(batchPayload);

            if (error) {
                logger.error(`Resend API Error (bulk email chunk ${i / CHUNK_SIZE + 1}):`, error);
                hasError = true;
                lastError = error.message || 'Email delivery failed for some recipients';
                // Continue sending to other chunks even if one fails
            } else { successfulSends += chunk.length;
            }
        }

        if (hasError && successfulSends === 0) { return { success: false as const, error: lastError, data: null };
        }

        // Log email in database
        await db.collection(COLLECTIONS.EMAIL_HISTORY).add({ recipients: recipients,
            subject,
            body,
            recipientCount: successfulSends,
            attemptedCount: emails.length,
            sentBy: adminCheck.userId,
            sentAt: FieldValue.serverTimestamp(),
            status: hasError ? 'partial' : 'sent',
            error: hasError ? lastError : null
        });

        return { success: true as const, data: { recipientCount: emails.length }, error: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "Failed to send email. Please try again.";
        logger.error('Failed to send bulk email:', error);
        return { success: false as const, error: message, data: null };
    }
}

/**
 * Create platform announcement
 * Displayed on user dashboards
 */
export async function createAnnouncementAction(prevState: ActionResponse<unknown>, formData: FormData): Promise<ActionResponse<{ id: string }>> { const adminCheck = await requireAdmin();
    if ("error" in adminCheck) return { success: false as const, error: "Unauthorized: admin role required", data: null };
    try { const title = (formData.get('title') as string | null)?.trim() ?? "";
        const message = (formData.get('message') as string | null)?.trim() ?? "";
        const priority = (formData.get('priority') as string | null)?.trim() ?? "";

        if (!title || !message || !priority) {
            return { success: false as const, error: 'All fields are required', data: null };
        }

        // Create announcement in database
        const announcementRef = await db.collection(COLLECTIONS.ANNOUNCEMENTS).add({ title,
            message,
            priority,
            active: true,
            createdBy: adminCheck.userId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        return { error: null, success: true as const, data: { id: announcementRef.id } };
    } catch (error) { logger.error('Failed to create announcement:', error);
        return { success: false as const, error: 'Failed to create announcement. Please try again.', data: null };
    }
}


/**
 * Fetch admin email send history from Firestore (email_history collection)
 */
export async function getEmailHistoryAction(): Promise<ActionResponse<{ history: any[] }>> { const adminCheck = await requireAdmin();
    if ("error" in adminCheck) return { success: false as const, error: "Unauthorized: admin role required", data: null };
    try { const snapshot = await db.collection(COLLECTIONS.EMAIL_HISTORY)
            .orderBy('sentAt', 'desc')
            .limit(50)
            .get();

        const history = serializeDocs(snapshot.docs) as any[];

        return { error: null,  success: true as const, data: { history } };
    } catch (error) { logger.error('Failed to fetch email history:', error);
        return { success: false as const, error: 'Failed to load email history', data: null };
    }
}
