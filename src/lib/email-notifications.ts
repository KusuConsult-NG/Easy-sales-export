/**
 * Email Notification Utility
 * Simple placeholder for email notifications
 * Can be integrated with Resend or other email service
 */

interface EmailData {
    to: string;
    subject: string;
    message: string;
    metadata?: Record<string, any>;
}

/**
 * Send email notification using Resend
 * Production-ready implementation
 */
export async function sendEmailNotification(data: EmailData): Promise<{ success: boolean; error?: string }> {
    try {
        // Check for required environment variable
        if (!process.env.RESEND_API_KEY) {
            if (process.env.NODE_ENV !== 'production') {
                console.error('[EMAIL] RESEND_API_KEY not configured');
            }
            return { success: false, error: 'Email service not configured' };
        }

        // Dynamic import to keep bundle size small
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        const senderEmail = process.env.EMAIL_FROM || 'Easy Sales Export <noreply@easysalesexport.com>';

        // Send email via Resend
        const result = await resend.emails.send({
            from: senderEmail,
            to: data.to,
            subject: data.subject,
            html: data.message,
            // Add tags for tracking
            tags: data.metadata ? [
                { name: 'type', value: data.metadata.type || 'general' }
            ] : undefined,
        });

        // Log success for monitoring (development only)
        if (process.env.NODE_ENV !== 'production') {
            console.log('[EMAIL] Sent successfully:', {
                to: data.to,
                subject: data.subject,
                id: result.data?.id,
            });
        }

        return { success: true };
    } catch (error: any) {
        // Always log errors (needed for debugging production issues)
        console.error('[EMAIL] Failed to send:', {
            to: data.to,
            subject: data.subject,
            error: error.message,
        });

        return {
            success: false,
            error: error.message || 'Failed to send email'
        };
    }
}

/**
 * Send cooperative membership approval email
 */
export async function sendMembershipApprovalEmail(memberEmail: string, memberName: string) {
    return sendEmailNotification({
        to: memberEmail,
        subject: 'Cooperative Membership Approved',
        message: `
            <h2>Congratulations ${memberName}!</h2>
            <p>Your cooperative membership application has been approved.</p>
            <p>You can now access all member benefits and start contributing.</p>
            <p>Login to your dashboard to get started.</p>
        `,
        metadata: { type: 'membership_approval' },
    });
}

/**
 * Send cooperative membership rejection email
 */
export async function sendMembershipRejectionEmail(memberEmail: string, memberName: string, reason?: string) {
    return sendEmailNotification({
        to: memberEmail,
        subject: 'Cooperative Membership Application Update',
        message: `
            <h2>Hello ${memberName},</h2>
            <p>Thank you for your interest in joining our cooperative.</p>
            <p>Unfortunately, we are unable to approve your application at this time.</p>
            ${reason ? `<p>Reason: ${reason}</p>` : ''}
            <p>If you have questions, please contact our support team.</p>
        `,
        metadata: { type: 'membership_rejection', reason },
    });
}

/**
 * Send withdrawal confirmation email
 */
export async function sendWithdrawalConfirmationEmail(
    userEmail: string,
    userName: string,
    amount: number,
    withdrawalId: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: 'Withdrawal Request Received',
        message: `
            <h2>Hello ${userName},</h2>
            <p>We have received your withdrawal request.</p>
            <p><strong>Amount:</strong> ₦${amount.toLocaleString()}</p>
            <p><strong>Request ID:</strong> ${withdrawalId}</p>
            <p>Your request is being reviewed and will be processed within 3-5 business days.</p>
            <p>You will receive another email once the withdrawal is approved.</p>
        `,
        metadata: { type: 'withdrawal_confirmation', amount, withdrawalId },
    });
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
    userEmail: string,
    resetLink: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: 'Password Reset Request - Easy Sales Export',
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Password Reset Request</h2>
                <p>We received a request to reset your password for your Easy Sales Export account.</p>
                <p>Click the button below to reset your password:</p>
                <div style="margin: 30px 0; text-align: center;">
                    <a href="${resetLink}" 
                       style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                        Reset Password
                    </a>
                </div>
                <p style="color: #666; font-size: 14px;">
                    This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.
                </p>
                <p style="color: #666; font-size: 14px;">
                    For security, never share this email or link with anyone.
                </p>
            </div>
        `,
        metadata: { type: 'password_reset' },
    });
}

/**
 * Send WAVE application status email
 */
export async function sendWaveApplicationEmail(
    userEmail: string,
    userName: string,
    status: 'approved' | 'rejected',
    reason?: string
) {
    const isApproved = status === 'approved';

    return sendEmailNotification({
        to: userEmail,
        subject: `WAVE Application ${isApproved ? 'Approved' : 'Update'} - Easy Sales Export`,
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: ${isApproved ? '#16a34a' : '#333'};">
                    ${isApproved ? '🎉 Congratulations!' : 'WAVE Application Update'}
                </h2>
                <p>Hi ${userName},</p>
                ${isApproved ? `
                    <p>Your WAVE (Women Agripreneurs Visibility and Empowerment) program application has been <strong>approved</strong>!</p>
                    <p>You will receive further information about the program schedule and next steps via email.</p>
                    <p>Thank you for your commitment to agricultural entrepreneurship.</p>
                ` : `
                    <p>Thank you for your interest in the WAVE program.</p>
                    <p>We regret to inform you that we are unable to accept your application at this time.</p>
                    ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
                    <p>You may reapply in the next application cycle. For questions, please contact our support team.</p>
                `}
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="color: #666; font-size: 12px;">
                    Easy Sales Export - Agricultural Export Platform<br/>
                    Nigeria's Premier Platform for Women in Agriculture
                </p>
            </div>
        `,
        metadata: { type: 'wave_application', status },
    });
}
