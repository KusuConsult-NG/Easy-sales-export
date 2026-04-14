'use server';

import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from 'firebase-admin/firestore';
import { auth } from '@/lib/auth';
import { serializeDocs } from '@/lib/firestore-serialize';

export interface SendBulkEmailState {
    success: boolean;
    error?: string;
    recipientCount?: number;
}

export interface CreateAnnouncementState {
    success: boolean;
    error?: string;
    id?: string;
}

/**
 * Get recipient emails based on segment
 */
async function getRecipientEmails(segment: string): Promise<string[]> {
    console.log(`[AdminComms] getRecipientEmails called with segment: '${segment}'`);
    try {
        const query = db.collection(COLLECTIONS.USERS);
        let snapshot;

        const emails: string[] = [];

        if (segment === 'cooperative') {
            const coopQuery = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where('paymentStatus', '==', 'completed');
            const coopSnap = await coopQuery.get();
            console.log(`[AdminComms] cooperative segment: ${coopSnap.size} docs found`);
            coopSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.email) {
                    emails.push(data.email);
                }
            });
        } else {
            let snapshot;
            switch (segment) {
                case 'active':
                    snapshot = await query.where('status', '==', 'active').get();
                    break;
                case 'verified':
                    snapshot = await query.where('verified', '==', true).get();
                    break;
                case 'sellers':
                    snapshot = await query.where('roles', 'array-contains', 'seller').get();
                    break;
                case 'wave': {
                    const waveSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).get();
                    console.log(`[AdminComms] wave segment: ${waveSnap.size} docs found`);
                    waveSnap.docs.forEach(doc => {
                        const data = doc.data();
                        const email = data.email || data.userEmail;
                        if (email) emails.push(email);
                    });
                    return [...new Set(emails)];
                }
                case 'all':
                default:
                    snapshot = await query.get();
                    break;
            }

            console.log(`[AdminComms] segment '${segment}': ${snapshot.size} docs found in '${COLLECTIONS.USERS}'`);
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.email) {
                    emails.push(data.email);
                } else {
                    console.log(`[AdminComms] User doc ${doc.id} has no 'email' field. Fields: ${Object.keys(data).join(', ')}`);
                }
            });
        }

        console.log(`[AdminComms] Returning ${emails.length} emails (deduped: ${[...new Set(emails)].length})`);
        return [...new Set(emails)];
    } catch (error) {
        console.error('[AdminComms] ERROR in getRecipientEmails:', error);
        logger.error('Error fetching recipient emails:', error);
        return [];
    }
}

/**
 * Send bulk email to users
 * Accepts recipients segment, subject, and HTML body
 */
export async function sendBulkEmailAction(prevState: SendBulkEmailState, formData: FormData): Promise<SendBulkEmailState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        // Check if user is admin
        const userRef = db.collection(COLLECTIONS.USERS).doc(session?.user?.id || 'unknown');
        const userDoc = await userRef.get();
        const userData = userDoc.data();

        if (!session?.user || !userData?.roles?.includes('admin')) {
            // simplified check, relying on session claims is faster but verifying in DB is safer for critical actions
            if (!session?.user?.roles?.includes('admin')) {
                return { success: false, error: 'Unauthorized' };
            }
        }

        const recipients = formData.get('recipients') as string;
        const subject = formData.get('subject') as string;
        const body = formData.get('body') as string;

        console.log(`[AdminComms] sendBulkEmailAction — recipients: '${recipients}', subject: '${subject?.substring(0, 50)}', body length: ${body?.length || 0}`);

        if (!recipients || !subject || !body) {
            return { success: false, error: 'All fields are required' };
        }

        // Get recipient emails
        const emails = await getRecipientEmails(recipients);

        if (emails.length === 0) {
            return { success: false, error: 'No recipients found for this segment' };
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
            return { success: false, error: lastError };
        }

        // Log email in database
        await db.collection(COLLECTIONS.EMAIL_HISTORY).add({
            recipients: recipients,
            subject,
            body,
            recipientCount: successfulSends,
            attemptedCount: emails.length,
            sentBy: session.user.id,
            sentAt: FieldValue.serverTimestamp(),
            status: hasError ? 'partial' : 'sent',
            error: hasError ? lastError : null
        });

        return { success: true, recipientCount: emails.length };
    } catch (error: any) {
        logger.error('Failed to send bulk email:', error);
        return {
            success: false,
            error: error.message || 'Failed to send email. Please try again.'
        };
    }
}

/**
 * Create platform announcement
 * Displayed on user dashboards
 */
export async function createAnnouncementAction(prevState: CreateAnnouncementState, formData: FormData): Promise<CreateAnnouncementState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin')) {
            return { success: false, error: 'Unauthorized' };
        }

        const title = formData.get('title') as string;
        const message = formData.get('message') as string;
        const priority = formData.get('priority') as string;

        if (!title || !message || !priority) {
            return { success: false, error: 'All fields are required' };
        }

        // Create announcement in database
        const announcementRef = await db.collection(COLLECTIONS.ANNOUNCEMENTS).add({
            title,
            message,
            priority,
            active: true,
            createdBy: session.user.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        return { success: true, id: announcementRef.id };
    } catch (error) {
        logger.error('Failed to create announcement:', error);
        return {
            success: false,
            error: 'Failed to create announcement. Please try again.'
        };
    }
}

export interface GetEmailHistoryState {
    success: boolean;
    history?: any[];
    error?: string;
}

/**
 * Fetch admin email send history from Firestore (email_history collection)
 */
export async function getEmailHistoryAction(): Promise<GetEmailHistoryState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: 'Unauthorized' };
        if (!session.user.roles?.includes('admin') && !session.user.roles?.includes('super_admin')) {
            return { success: false, error: 'Unauthorized' };
        }

        const snapshot = await db.collection(COLLECTIONS.EMAIL_HISTORY)
            .orderBy('sentAt', 'desc')
            .limit(50)
            .get();

        const history = serializeDocs(snapshot.docs) as any[];

        return { success: true, history };
    } catch (error) {
        logger.error('Failed to fetch email history:', error);
        return { success: false, error: 'Failed to load email history' };
    }
}
