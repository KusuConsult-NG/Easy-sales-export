'use server';

import { logger } from '@/lib/logger';
import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { auth } from '@/lib/auth';

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
    try {
        const query = db.collection('users');
        let snapshot;

        // Simple segmentation based on roles or status
        // Note: In a real app, you might want to paginate this or use a dedicated email service for large lists
        let emails: string[] = [];

        if (segment === 'cooperative') {
            // 🐛 FIX: Fetch all members from cooperative_members collection directly
            // This ensures we get members who have completed onboarding and paid, even if they aren't approved yet.
            const coopQuery = db.collection('cooperative_members').where('paymentStatus', '==', 'completed');
            const coopSnap = await coopQuery.get();
            coopSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.email) {
                    emails.push(data.email);
                }
            });
        } else {
            // Handle standard segment logic against 'users' collection
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
                case 'wave':
                    snapshot = await query.where('roles', 'array-contains', 'wave_student').get();
                    break;
                case 'all':
                default:
                    snapshot = await query.get();
                    break;
            }

            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.email) {
                    emails.push(data.email);
                }
            });
        }

        // Remove duplicates
        return [...new Set(emails)];
    } catch (error) {
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
        const session = await auth();
        // Check if user is admin
        const userRef = db.collection('users').doc(session?.user?.id || 'unknown');
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

        // Batch sending to avoid hitting limits if possible, or send as bcc
        // For privacy, we should ALWAYS use Bcc for bulk emails
        await resend.emails.send({
            from: 'Easy Sales Export <onboarding@resend.dev>',
            to: 'admin@easysalesexport.com', // Send to admin, bcc everyone else
            bcc: emails,
            subject: subject,
            html: body
        });

        // Log email in database
        await db.collection('email_history').add({
            recipients: recipients,
            subject,
            body,
            recipientCount: emails.length,
            sentBy: session.user.id,
            sentAt: FieldValue.serverTimestamp(),
            status: 'sent'
        });

        return {
            success: true,
            recipientCount: emails.length
        };
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
        const session = await auth();
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
        const announcementRef = await db.collection('announcements').add({
            title,
            message,
            priority,
            active: true,
            createdBy: session.user.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        return {
            success: true,
            id: announcementRef.id
        };
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
        const session = await auth();
        if (!session?.user) return { success: false, error: 'Unauthorized' };
        if (!session.user.roles?.includes('admin') && !session.user.roles?.includes('super_admin')) {
            return { success: false, error: 'Unauthorized' };
        }

        const snapshot = await db.collection('email_history')
            .orderBy('sentAt', 'desc')
            .limit(50)
            .get();

        const history = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            sentAt: doc.data().sentAt?.toDate?.()?.toISOString?.() ?? null,
        }));

        return { success: true, history };
    } catch (error) {
        logger.error('Failed to fetch email history:', error);
        return { success: false, error: 'Failed to load email history' };
    }
}
