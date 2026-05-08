'use server';

import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from 'firebase-admin/firestore';
import { serializeDocs } from '@/lib/firestore-serialize';

export interface SendBulkEmailState {
    success: true | false;
    error?: string;
    recipientCount?: number;
}

export interface CreateAnnouncementState {
    success: true | false;
    error?: string;
    id?: string;
}

/**
 * Get recipient emails based on segment
 */
async function getRecipientEmails(segment: string): Promise<string[]> {
    logger.info(`[AdminComms] getRecipientEmails called with segment: '${segment}'`);
    try {
        const query = db.collection(COLLECTIONS.USERS);
        let snapshot;

        const emails: string[] = [];

        if (segment === 'cooperative') {
            const stream = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where('paymentStatus', '==', 'completed')
                .select('email')
                .get();
            let count = 0;
            for (const doc of (await stream).docs) {
                const data = doc.data();
                if (data.email) emails.push(data.email);
                count++;
            }
            logger.info(`[AdminComms] cooperative segment: ${count} docs found`);
        } else {
            let stream: any;
            switch (segment) {
                case 'active':
                    stream = query.where('status', '==', 'active').select('email').get();
                    break;
                case 'verified':
                    stream = query.where('verified', '==', true).select('email').get();
                    break;
                case 'sellers':
                    stream = query.where('roles', 'array-contains', 'seller').select('email').get();
                    break;
                case 'wave': {
                    const waveStream = db.collection(COLLECTIONS.WAVE_APPLICATIONS).select('email', 'userEmail').get();
                    let waveCount = 0;
                    for (const doc of (await waveStream).docs) {
                        const data = doc.data();
                        const email = data.email || data.userEmail;
                        if (email) emails.push(email);
                        waveCount++;
                    }
                    logger.info(`[AdminComms] wave segment: ${waveCount} docs found`);
                    return [...new Set(emails)];
                }
                case 'all':
                default:
                    stream = query.select('email').get();
                    break;
            }

            let mainCount = 0;
            for (const doc of (await stream).docs) {
                const data = doc.data();
                if (data.email) {
                    emails.push(data.email);
                }
                mainCount++;
            }
            logger.info(`[AdminComms] segment '${segment}': ${mainCount} docs processed`);
        }

        logger.info(`[AdminComms] Returning ${emails.length} emails (deduped: ${[...new Set(emails)].length})`);
        return [...new Set(emails)];
    } catch (error) {
        logger.error('[AdminComms] ERROR in getRecipientEmails:', error);
        return [];
    }
}

/**
 * Send bulk email to users
 * Accepts recipients segment, subject, and HTML body
 */
export async function sendBulkEmailAction(prevState: SendBulkEmailState, formData: FormData): Promise<SendBulkEmailState> {
    const adminCheck = await requireAdmin();
    if ("error" in adminCheck) return { success: false as const, error: "Unauthorized: admin role required" };
    try {
        const recipients = formData.get('recipients') as string;
        const subject = formData.get('subject') as string;
        const body = formData.get('body') as string;

        logger.info(`[AdminComms] sendBulkEmailAction — recipients: '${recipients}', subject: '${subject?.substring(0, 50)}', body length: ${body?.length || 0}`);

        if (!recipients || !subject || !body) {
            return { success: false as const, error: 'All fields are required' };
        }

        // Get recipient emails
        const emails = await getRecipientEmails(recipients);

        if (emails.length === 0) {
            return { success: false as const, error: 'No recipients found for this segment' };
        }

        // Send email via Resend
        // Note: Resend basic tier has limits. For production bulk email, consider batching or a different provider.
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Batch sending to avoid hitting limits
        const fromAddress = process.env.RESEND_FROM_EMAIL || 'noreply@easysalesexport.com';

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
            } else {
                successfulSends += chunk.length;
            }
        }

        if (hasError && successfulSends === 0) {
            return { success: false as const, error: lastError };
        }

        // Log email in database
        await db.collection(COLLECTIONS.EMAIL_HISTORY).add({
            recipients: recipients,
            subject,
            body,
            recipientCount: successfulSends,
            attemptedCount: emails.length,
            sentBy: adminCheck.userId,
            sentAt: FieldValue.serverTimestamp(),
            status: hasError ? 'partial' : 'sent',
            error: hasError ? lastError : null
        });

        return { success: true as const, recipientCount: emails.length };
    } catch (error: any) {
        logger.error('Failed to send bulk email:', error);
        return {
            success: false as const,
            error: error.message || 'Failed to send email. Please try again.'
        };
    }
}

/**
 * Create platform announcement
 * Displayed on user dashboards
 */
export async function createAnnouncementAction(prevState: CreateAnnouncementState, formData: FormData): Promise<CreateAnnouncementState> {
    const adminCheck = await requireAdmin();
    if ("error" in adminCheck) return { success: false as const, error: "Unauthorized: admin role required" };
    try {

        const title = formData.get('title') as string;
        const message = formData.get('message') as string;
        const priority = formData.get('priority') as string;

        if (!title || !message || !priority) {
            return { success: false as const, error: 'All fields are required' };
        }

        // Create announcement in database
        const announcementRef = await db.collection(COLLECTIONS.ANNOUNCEMENTS).add({
            title,
            message,
            priority,
            active: true,
            createdBy: adminCheck.userId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        return { success: true as const, id: announcementRef.id };
    } catch (error) {
        logger.error('Failed to create announcement:', error);
        return {
            success: false as const,
            error: 'Failed to create announcement. Please try again.'
        };
    }
}

export type GetEmailHistoryState = {
    success: true as const;
    history: any[];
    error: null;
} | {
    success: false as const;
    error: string;
    history?: undefined;
};

/**
 * Fetch admin email send history from Firestore (email_history collection)
 */
export async function getEmailHistoryAction(): Promise<GetEmailHistoryState> {
    const adminCheck = await requireAdmin();
    if ("error" in adminCheck) return { success: false as const, error: "Unauthorized: admin role required" };
    try {

        const snapshot = await db.collection(COLLECTIONS.EMAIL_HISTORY)
            .orderBy('sentAt', 'desc')
            .limit(50)
            .get();

        const history = serializeDocs(snapshot.docs) as any[];

        return { success: true as const, history, error: null };
    } catch (error) {
        logger.error('Failed to fetch email history:', error);
        return { success: false as const, error: 'Failed to load email history' };
    }
}
