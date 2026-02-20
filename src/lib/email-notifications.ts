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

/**
 * Send Withdrawal Approved Email
 */
export async function sendWithdrawalApprovedEmail(
    userEmail: string,
    userName: string,
    amount: number,
    withdrawalId: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: 'Funds Disbursed - Withdrawal Approved',
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #16a34a;">Withdrawal Approved</h2>
                <p>Hello ${userName},</p>
                <p>Your withdrawal request for <strong>₦${amount.toLocaleString()}</strong> has been approved and processed.</p>
                <p><strong>Reference ID:</strong> ${withdrawalId}</p>
                <p>The funds should reflect in your bank account shortly.</p>
                <p>Thank you for banking with us.</p>
            </div>
        `,
        metadata: { type: 'withdrawal_approved', withdrawalId },
    });
}

/**
 * Send Withdrawal Rejected Email
 */
export async function sendWithdrawalRejectedEmail(
    userEmail: string,
    userName: string,
    amount: number,
    reason: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: 'Update on Your Withdrawal Request',
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #dc2626;">Withdrawal Request Rejected</h2>
                <p>Hello ${userName},</p>
                <p>We are unable to process your withdrawal request for <strong>₦${amount.toLocaleString()}</strong> at this time.</p>
                <p><strong>Reason:</strong> ${reason}</p>
                <p>The funds have been returned to your savings balance.</p>
                <p>Please contact support if you believe this is an error.</p>
            </div>
        `,
        metadata: { type: 'withdrawal_rejected', reason },
    });
}
/**
 * Send Briefing Confirmation Email — "You Are Now Officially Positioned"
 * Sent immediately after successful registration.
 */
export async function sendBriefingConfirmationEmail(
    userEmail: string,
    userName: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: '⚠ You Are Now Officially Positioned',
        message: `
            <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1a1a1a; line-height: 1.8;">
                <p style="font-size: 16px;">
                    You have just done something most Nigerians will ignore.
                </p>

                <p style="font-size: 16px;">
                    You positioned yourself early.
                </p>

                <p style="font-size: 16px;">
                    This briefing is not motivational talk.
                </p>

                <p style="font-size: 16px;">
                    It is structural insight into:
                </p>

                <ul style="font-size: 16px; padding-left: 24px; line-height: 2.2;">
                    <li>How WAVE capital works</li>
                    <li>How ₦1M multiplies</li>
                    <li>How national food security is creating new wealth pipelines</li>
                    <li>How cooperative positioning gives advantage</li>
                </ul>

                <p style="font-size: 16px; font-weight: bold; margin-top: 28px;">
                    Important:
                </p>
                <div style="margin-bottom: 28px;">
                    <p style="font-size: 16px; margin: 4px 0;">Arrive prepared.</p>
                    <p style="font-size: 16px; margin: 4px 0;">Arrive attentive.</p>
                    <p style="font-size: 16px; margin: 4px 0;">Arrive ready to act.</p>
                </div>

                <p style="font-size: 16px;">
                    The link / venue details will be sent 24 hours before the event.
                </p>

                <p style="font-size: 16px;">
                    Watch your inbox carefully.
                </p>

                <br />
                <p style="font-size: 16px;">— <strong>Sir Abdallah</strong></p>
            </div>
        `,
        metadata: { type: 'briefing_confirmation' },
    });
}

/**
 * Send 24-Hour Briefing Reminder — "Tomorrow Changes Your Financial Direction"
 * Send to ALL registrants 24 hours before the briefing event.
 * Trigger from a scheduled cron job or admin action iterating over
 * all docs in `wave_briefing_registrations` where status === "registered".
 */
export async function sendBriefing24HourReminderEmail(
    userEmail: string,
    userName: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: 'Tomorrow Changes Your Financial Direction',
        message: `
            <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1a1a1a; line-height: 1.8;">
                <p style="font-size: 16px;">
                    Tomorrow, you will see:
                </p>

                <p style="font-size: 16px;">
                    Why agriculture is no longer for survival…<br />
                    But for structured wealth.
                </p>

                <p style="font-size: 16px;">
                    Come with:
                </p>

                <ul style="font-size: 16px; padding-left: 24px; line-height: 2.2;">
                    <li>Notebook</li>
                    <li>Questions</li>
                    <li>Serious mindset</li>
                </ul>

                <p style="font-size: 16px; margin: 28px 0;">
                    Those who come casually will leave confused.
                </p>

                <p style="font-size: 16px; margin: 28px 0;">
                    Those who come serious will leave positioned.
                </p>

                <p style="font-size: 16px;">
                    See you inside.
                </p>

                <br />
                <p style="font-size: 16px;">— <strong>Sir Abdallah</strong></p>
            </div>
        `,
        metadata: { type: 'briefing_24hr_reminder' },
    });
}
