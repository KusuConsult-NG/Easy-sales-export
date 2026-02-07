'use server';

import { db } from '@/lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
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
    // TODO: Implement actual user querying from Firebase
    // For now, return mock emails for demonstration
    const mockEmails: Record<string, string[]> = {
        all: ['user1@example.com', 'user2@example.com'],
        active: ['active@example.com'],
        verified: ['verified@example.com'],
        cooperative: ['coop@example.com'],
        wave: ['wave@example.com'],
        sellers: ['seller@example.com']
    };

    return mockEmails[segment] || [];
}

/**
 * Send bulk email to users
 * Accepts recipients segment, subject, and HTML body
 */
export async function sendBulkEmailAction(prevState: SendBulkEmailState, formData: FormData): Promise<SendBulkEmailState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes('admin')) {
            return { success: false, error: 'Unauthorized' };
        }

        const recipients = formData.get('recipients') as string;
        const subject = formData.get('subject') as string;
        const body = formData.get('body') as string;

        if (!recipients || !subject || !body) {
            return { success: false, error: 'All fields are required' };
        }

        // Get recipient emails
        const emails = await getRecipientEmails(recipients);

        // Send email via Resend
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        await resend.emails.send({
            from: 'Easy Sales Export <onboarding@resend.dev>',
            to: emails,
            subject: subject,
            html: body
        });

        console.log('Bulk email sent:', { to: emails, subject });

        // Log email in database
        await addDoc(collection(db, 'email_history'), {
            recipients: recipients,
            subject,
            body,
            recipientCount: emails.length,
            sentBy: session.user.id,
            sentAt: new Date(),
            status: 'sent'
        });

        return {
            success: true,
            recipientCount: emails.length
        };
    } catch (error) {
        console.error('Failed to send bulk email:', error);
        return {
            success: false,
            error: 'Failed to send email. Please try again.'
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
        if (!session?.user || !session.user.roles?.includes('admin')) {
            return { success: false, error: 'Unauthorized' };
        }

        const title = formData.get('title') as string;
        const message = formData.get('message') as string;
        const priority = formData.get('priority') as string;

        if (!title || !message || !priority) {
            return { success: false, error: 'All fields are required' };
        }

        // Create announcement in database
        const announcementRef = await addDoc(collection(db, 'announcements'), {
            title,
            message,
            priority,
            active: true,
            createdBy: session.user.id,
            createdAt: new Date()
        });

        return {
            success: true,
            id: announcementRef.id
        };
    } catch (error) {
        console.error('Failed to create announcement:', error);
        return {
            success: false,
            error: 'Failed to create announcement. Please try again.'
        };
    }
}
