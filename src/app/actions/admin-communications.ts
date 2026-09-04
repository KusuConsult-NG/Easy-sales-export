"use server";

import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { serializeDocs } from '@/lib/firestore-serialize';
import { communicationsService } from '@/services';
import { recordAdminAction } from '@/lib/audit-log';

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
export async function sendBulkEmailAction(prevState: ActionResponse<unknown>, formData: FormData): Promise<ActionResponse<{ recipientCount: number; attemptedCount: number }>> { const adminCheck = await requireAdmin("announcements:manage");
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
        /**
         * THE FROM HEADER WAS BUILT TWICE, AND BULK EMAIL COULD NOT SEND.
         *
         * The value was used as `from: `Easy Sales Export <${fromAddress}>``
         * while fromAddress ALREADY holds a complete "Name <address>" string —
         * its own default is 'Easy Sales Export <info@easysalesexport.com>'. So
         * the header came out as
         *
         *     Easy Sales Export <Easy Sales Export <info@easysalesexport.com>>
         *
         * which is not a valid address. Every other EMAIL_FROM call site in this
         * codebase — ten of them, in admin/_land, _legacy, _academy, _exports,
         * _marketplace, _loans and the rest — passes the variable straight
         * through as `from`. This file alone wrapped it.
         */
        const fromAddress = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'Easy Sales Export <info@easysalesexport.com>';

        const CHUNK_SIZE = 100;
        let successfulSends = 0;
        let hasError = false;
        let lastError = '';

        for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
            const chunk = emails.slice(i, i + CHUNK_SIZE);
            const batchPayload = chunk.map(email => ({
                from: fromAddress,
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

        /**
         * The count that was actually DELIVERED, not the count attempted.
         *
         * This returned `emails.length` while the database row beside it
         * recorded `successfulSends` — so on a partial failure the screen told
         * the admin every recipient had been reached and the history said
         * otherwise. attemptedCount is returned alongside so the difference is
         * visible rather than hidden.
         */
        await recordAdminAction({
            action: 'broadcast_sent',
            userId: adminCheck.userId,
            targetType: 'email_broadcast',
            targetId: recipients,
            metadata: { subject, attempted: emails.length, delivered: successfulSends, partial: hasError },
        });

        return {
            success: true as const,
            data: { recipientCount: successfulSends, attemptedCount: emails.length },
            error: null,
        };
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
export async function createAnnouncementAction(prevState: ActionResponse<unknown>, formData: FormData): Promise<ActionResponse<{ id: string }>> { const adminCheck = await requireAdmin("announcements:manage");
    if ("error" in adminCheck) return { success: false as const, error: "Unauthorized: admin role required", data: null };
    try { const title = (formData.get('title') as string | null)?.trim() ?? "";
        const message = (formData.get('message') as string | null)?.trim() ?? "";
        const priority = (formData.get('priority') as string | null)?.trim() ?? "";

        if (!title || !message || !priority) {
            return { success: false as const, error: 'All fields are required', data: null };
        }

        // Create announcement in database
        // `content` and `targetAudience` are written because the only reader of
        // this collection needs both.
        //
        // cms.ts's getActiveAnnouncementsAction maps `content` (this wrote only
        // `message`) and, since the entitlement fix, returns nothing whose
        // targetAudience it does not recognise — and an absent one is not
        // recognised. It was invisible before that too: the old filter dropped
        // anything whose audience was neither "all" nor the requested one, and
        // undefined is neither.
        //
        // So every row this action has ever written was unreadable by the only
        // thing that reads them. It has no callers today, which is the only
        // reason nobody has noticed; wiring the form up would have published
        // announcements that never appeared anywhere.
        //
        // `message` is kept alongside `content` rather than renamed, in case a
        // row somewhere is already read by it.
        const announcementRef = await db.collection(COLLECTIONS.ANNOUNCEMENTS).add({ title,
            message,
            content: message,
            targetAudience: "all",
            priority,
            active: true,
            createdBy: adminCheck.userId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        await recordAdminAction({
            action: 'announcement_created',
            userId: adminCheck.userId,
            targetType: 'announcement',
            targetId: announcementRef.id,
            metadata: { title, priority },
        });

        return { error: null, success: true as const, data: { id: announcementRef.id } };
    } catch (error) { logger.error('Failed to create announcement:', error);
        return { success: false as const, error: 'Failed to create announcement. Please try again.', data: null };
    }
}


/**
 * Fetch admin email send history from Firestore (email_history collection)
 */
export async function getEmailHistoryAction(): Promise<ActionResponse<{ history: any[] }>> { const adminCheck = await requireAdmin("announcements:manage");
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
