/**
 * Email Notification Utility
 * Simple placeholder for email notifications
 * Can be integrated with Resend or other email service
 */

import { escapeHtml } from "@/lib/utils";

/**
 * EVERY VALUE INTERPOLATED INTO A TEMPLATE BELOW IS ESCAPED.
 *
 * Thirty-two interpolations — names, rejection reasons, product and window
 * titles, a temporary PIN, invite and reset URLs — went into HTML raw. Two
 * consequences, and the boring one is the common one:
 *
 *   A NAME BREAKS THE EMAIL. "Smith & Sons <Nigeria> Ltd" is an ordinary
 *   Nigerian business name and an ampersand followed by a tag that does not
 *   close. Whatever followed it in the markup was swallowed by the client.
 *
 *   AND A REJECTION REASON IS FREE TEXT. An admin types it and a member reads
 *   it, in an HTML document, with no filter between the two.
 *
 * escapeHtml already existed in lib/utils.ts and this file used none of it —
 * reviews.ts is the only caller in the codebase. Escaping the URLs is correct
 * too, not merely harmless: `&` inside an href must be `&amp;` in HTML, which
 * is what every client then decodes back to `&`.
 */

interface EmailData {
    to: string;
    subject: string;
    message: string;
    metadata?: Record<string, any>;
    headers?: Record<string, string>;
}

/**
 * Helper to get the application base URL with fallbacks.
 * Prioritizes NEXT_PUBLIC_APP_URL, then NEXTAUTH_URL, and finally the production fallback.
 */
export function getBaseUrl(): string {
    let url = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://easysalesexport.com';
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        const isLocalhost = hostname.endsWith('localhost');
        
        if (isLocalhost) {
            // Strip any subdomains on localhost (e.g. wave.localhost -> localhost)
            const parts = hostname.split('.');
            if (parts.length > 1) {
                const firstPart = parts[0];
                const knownSubdomains = ['wave', 'cooperatives', 'academy', 'marketplace', 'farm-nation', 'farmnation', 'export', 'finance'];
                if (knownSubdomains.includes(firstPart)) {
                    parsed.hostname = 'localhost';
                    url = parsed.toString();
                }
            }
        } else {
            // In production, map subdomains and known module domains back to the apex domain: www.easysalesexport.com
            if (hostname === 'easysalesexport.com' || (hostname.endsWith('.easysalesexport.com') && hostname !== 'www.easysalesexport.com')) {
                parsed.hostname = 'www.easysalesexport.com';
                url = parsed.toString();
            } else {
                const knownModuleDomains = [
                    'easysalescooperative.com',
                    'www.easysalescooperative.com',
                    'easysalesmarket.com',
                    'www.easysalesmarket.com',
                    'farmnation.ng',
                    'www.farmnation.ng',
                    'easysalesacademy.com',
                    'www.easysalesacademy.com',
                    'easysalesexportng.com',
                    'www.easysalesexportng.com',
                ];
                if (knownModuleDomains.includes(hostname)) {
                    parsed.hostname = 'www.easysalesexport.com';
                    url = parsed.toString();
                }
            }
        }
        if (url.endsWith('/')) {
            url = url.slice(0, -1);
        }
    } catch {}
    return url;
}

/**
 * Send email notification using Resend
 * Production-ready implementation
 */
export async function sendEmailNotification(data: EmailData): Promise<{ success: boolean; error?: string }> {
    try {
        /**
         * A MISSING API KEY WAS SILENT IN THE ONE PLACE IT MATTERS.
         *
         * This read `if (process.env.NODE_ENV !== 'production')` before
         * logging — so in PRODUCTION a missing or revoked RESEND_API_KEY made
         * every email in the platform fail with no output at all. And every
         * caller treats email as non-fatal ("Don't block success on email
         * failure" appears verbatim in four of them), so nothing surfaced
         * anywhere: membership approvals, rejections, password resets, briefing
         * confirmations, withdrawal notifications, the legacy welcome carrying
         * a member's temporary PIN — all quietly undelivered, indefinitely.
         *
         * The suppression was presumably meant to keep dev logs quiet. It is
         * the send SUCCESS log below that should be dev-only, and it already is.
         */
        if (!process.env.RESEND_API_KEY) {
            console.error('[EMAIL] RESEND_API_KEY not configured — no email can be sent.');
            return { success: false, error: 'Email service not configured' };
        }

        // Dynamic import to keep bundle size small
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        const senderEmail = process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>';

        // Send email via Resend
        const result = await resend.emails.send({
            from: senderEmail,
            to: data.to,
            subject: data.subject,
            html: data.message,
            headers: data.headers,
            // Add tags for tracking
            tags: data.metadata ? [
                { name: 'type', value: data.metadata.type || 'general' }
            ] : undefined,
        });

        if (result.error) {
            console.error('[EMAIL] Resend API Error:', result.error);
            return { success: false, error: result.error.message };
        }

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
 * Send Batch Email notifications using Resend
 * Supports up to 100 emails in a single extremely fast API payload.
 * Eliminates "429 Too Many Requests" errors when broadcasting.
 */
export async function sendBatchEmailNotifications(emails: EmailData[]): Promise<{ success: boolean; sent: number; error?: string }> {
    try {
        // Logged in production too — see the note in sendEmailNotification.
        if (!process.env.RESEND_API_KEY) {
            console.error('[EMAIL BATCH] RESEND_API_KEY not configured — no email can be sent.');
            return { success: false, sent: 0, error: 'Email service not configured' };
        }

        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const senderEmail = process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>';

        const toPayload = (data: EmailData) => ({
            from: senderEmail,
            to: [data.to],
            subject: data.subject,
            html: data.message,
            headers: data.headers,
            tags: data.metadata ? [
                { name: 'type', value: data.metadata.type || 'general' }
            ] : undefined,
        });

        /**
         * CHUNKED, which the doc comment above has always claimed and the code
         * did not do.
         *
         * "Supports up to 100 emails in a single extremely fast API payload" —
         * and then it passed the WHOLE array to resend.batch.send(). A caller
         * handing it 150 would get one rejected request and zero emails, with
         * `sent: 0` and a Resend error nobody would connect to the size of the
         * list. Its one caller today chunks at 100 itself, so this never fired;
         * the limit belongs with the function that has it, not with each caller
         * that has to remember.
         *
         * A failed chunk does not abandon the rest, and the count returned is
         * what was ACCEPTED rather than what was attempted — the correction
         * made to the other bulk sender in #188.
         */
        const BATCH_LIMIT = 100;
        let sent = 0;
        let lastError: string | undefined;

        for (let i = 0; i < emails.length; i += BATCH_LIMIT) {
            const chunk = emails.slice(i, i + BATCH_LIMIT);
            const result = await resend.batch.send(chunk.map(toPayload));

            if (result.error) {
                lastError = result.error.message;
                console.error(
                    `[EMAIL BATCH] Resend API error on chunk ${Math.floor(i / BATCH_LIMIT) + 1} ` +
                    `of ${Math.ceil(emails.length / BATCH_LIMIT)}:`,
                    result.error
                );
                continue;
            }

            sent += chunk.length;
        }

        if (sent === 0 && emails.length > 0) {
            return { success: false, sent: 0, error: lastError || 'Failed to send batch payload' };
        }

        if (process.env.NODE_ENV !== 'production') {
            console.log(`[EMAIL BATCH] Dispatched ${sent} of ${emails.length} batched emails.`);
        }

        return { success: true, sent, ...(lastError ? { error: lastError } : {}) };
    } catch (error: any) {
        console.error('[EMAIL BATCH] Failed to send bulk batch:', error.message);
        return { success: false, sent: 0, error: error.message || 'Failed to send batch payload' };
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
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <div style="background-color: #7c3aed; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Membership Approved!</h1>
                </div>
                <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${escapeHtml(String(memberName ?? ""))}</strong>,</p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
                        Congratulations! Your Easy Sales Export Cooperative membership application has been <strong>approved</strong>.
                    </p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
                        You can now access all member benefits, start contributing, and explore cooperative funding opportunities.
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${getBaseUrl()}/cooperatives/dashboard"
                           style="background-color: #7c3aed; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">
                            Go to Cooperative Dashboard &rarr;
                        </a>
                    </div>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
                        Easy Sales Export &mdash; Nigeria's Premier Agricultural Export Platform
                    </p>
                </div>
            </div>
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
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <div style="background-color: #ef4444; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px;">Application Update Required</h1>
                </div>
                <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${escapeHtml(String(memberName ?? ""))}</strong>,</p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
                        Thank you for your interest in joining our cooperative.
                    </p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
                        Unfortunately, we are unable to approve your application at this time.
                    </p>
                    ${reason ? `
                    <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0;">
                        <p style="margin: 0; font-size: 14px; font-weight: bold; color: #991b1b;">Admin Feedback:</p>
                        <p style="margin: 4px 0 0; font-size: 14px; color: #7f1d1d;">${escapeHtml(String(reason ?? ""))}</p>
                    </div>
                    ` : ''}
                    <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
                        If you have questions or need clarification, please contact our support team.
                    </p>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
                        Easy Sales Export &mdash; Nigeria's Premier Agricultural Export Platform
                    </p>
                </div>
            </div>
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
            <h2>Hello ${escapeHtml(String(userName ?? ""))},</h2>
            <p>We have received your withdrawal request.</p>
            <p><strong>Amount:</strong> ₦${amount.toLocaleString()}</p>
            <p><strong>Request ID:</strong> ${escapeHtml(String(withdrawalId ?? ""))}</p>
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
                    <a href="${escapeHtml(String(resetLink ?? ""))}" 
                       style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                        Reset Password
                    </a>
                </div>
                <p style="color: #ef4444; font-size: 14px; font-weight: bold; margin-top: 24px;">
                    ⚠️ This link will expire in 1 hour. If it expires, please go to the login page and click "Forgot Password" to request a new one.
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

    const message = isApproved ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #059669;">Congratulations!</h2>
            <p>Hi ${escapeHtml(String(userName ?? ""))},</p>
            <p>We are thrilled to inform you that your application for the <strong>Women Agro-Value Expansion (WAVE)</strong> program has been approved.</p>
            
            <div style="background: #ecfdf5; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #a7f3d0;">
                <p style="margin: 0; color: #065f46;"><strong>Status:</strong> Approved</p>
                <p style="margin: 5px 0 0; color: #065f46;"><strong>Role:</strong> WAVE Participant</p>
            </div>

            <p>You now have full access to:</p>
            <ul>
                <li>Exclusive WAVE training resources and guides</li>
                <li>Cooperative funding opportunities</li>
                <li>Marketplace features</li>
            </ul>

            <p><strong>Next Steps:</strong></p>
            <p>Log in to your dashboard to start exploring the resources available to you.</p>

            <div style="text-align: center; margin-top: 30px;">
                <a href="${getBaseUrl()}/wave/dashboard" style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to WAVE Dashboard</a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="color: #666; font-size: 12px; text-align: center;">
                Easy Sales Export - Women Agripreneurs Visibility and Empowerment
            </p>
        </div>
    ` : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc2626;">WAVE Application Update</h2>
            <p>Hi ${escapeHtml(String(userName ?? ""))},</p>
            <p>Thank you for your interest in the Women Agro-Value Expansion (WAVE) program.</p>
            
            <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <p>Unfortunately, we are unable to approve your application at this time.</p>
                ${reason ? `
                <p><strong>Reason provided:</strong></p>
                <p style="font-style: italic;">"${escapeHtml(String(reason ?? ""))}"</p>
                ` : ''}
            </div>

            <p><strong>What You Can Do:</strong></p>
            <ul>
                <li>Review any feedback provided</li>
                <li>Ensure all your profile details are accurate</li>
                <li>Re-apply when you have made the necessary adjustments</li>
            </ul>

            <p>If you have any questions or need clarification, please contact our support team.</p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="color: #666; font-size: 12px; text-align: center;">
                Easy Sales Export - Women Agripreneurs Visibility and Empowerment
            </p>
        </div>
    `;

    return sendEmailNotification({
        to: userEmail,
        subject: `WAVE Application ${isApproved ? 'Approved' : 'Update'} - Easy Sales Export`,
        message,
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
                <p>Hello ${escapeHtml(String(userName ?? ""))},</p>
                <p>Your withdrawal request for <strong>₦${amount.toLocaleString()}</strong> has been approved and processed.</p>
                <p><strong>Reference ID:</strong> ${escapeHtml(String(withdrawalId ?? ""))}</p>
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
                <p>Hello ${escapeHtml(String(userName ?? ""))},</p>
                <p>We are unable to process your withdrawal request for <strong>₦${amount.toLocaleString()}</strong> at this time.</p>
                <p><strong>Reason:</strong> ${escapeHtml(String(reason ?? ""))}</p>
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

/**
 * Send Export Window Completion Email
 * Sent to each investor when an export window is marked "completed".
 * Includes their invested amount, expected return, and ROI.
 */
export async function sendExportWindowCompleteEmail(
    userEmail: string,
    userName: string,
    windowTitle: string,
    amountInvested: number,
    returnAmount: number,
    roi: string
) {
    const profit = returnAmount - amountInvested;
    return sendEmailNotification({
        to: userEmail,
        subject: `🎉 Your Export Returns Are Ready — ${escapeHtml(String(windowTitle ?? ""))}`,
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <h2 style="color: #16a34a;">Your Export Returns Are Ready!</h2>
                <p>Hello ${escapeHtml(String(userName ?? ""))},</p>
                <p>Your investment in <strong>${escapeHtml(String(windowTitle ?? ""))}</strong> has been completed successfully.</p>

                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <table style="width:100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 6px 0; color: #166534; font-weight: bold;">Amount Invested</td>
                            <td style="padding: 6px 0; color: #166534; text-align: right;">₦${amountInvested.toLocaleString()}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #166534; font-weight: bold;">Profit Earned</td>
                            <td style="padding: 6px 0; color: #16a34a; text-align: right; font-size: 18px; font-weight: bold;">+₦${profit.toLocaleString()}</td>
                        </tr>
                        <tr style="border-top: 1px solid #bbf7d0;">
                            <td style="padding: 10px 0; color: #14532d; font-weight: bold; font-size: 16px;">Total Return</td>
                            <td style="padding: 10px 0; color: #14532d; text-align: right; font-size: 20px; font-weight: bold;">₦${returnAmount.toLocaleString()}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #166534;">ROI</td>
                            <td style="padding: 6px 0; color: #16a34a; text-align: right; font-weight: bold;">${escapeHtml(String(roi ?? ""))}</td>
                        </tr>
                    </table>
                </div>

                <p>Your funds are ready for withdrawal. Log in to your dashboard to request a withdrawal.</p>

                <div style="text-align: center; margin: 32px 0;">
                    <a href="${getBaseUrl()}/export/transactions"
                       style="background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                        View My Returns
                    </a>
                </div>

                <p style="color: #6b7280; font-size: 13px;">
                    Thank you for investing with Easy Sales Export. We look forward to your continued participation.
                </p>
            </div>
        `,
        metadata: { type: 'export_window_complete', windowTitle, amountInvested, returnAmount },
    });
}


/**
 * Send WAVE Briefing WhatsApp Group Invite Email
 * Contains a one-time-use button. The inviteUrl encodes a single-use token.
 */
export async function sendWaveWhatsAppInviteEmail(
    userEmail: string,
    userName: string,
    inviteUrl: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: "Your WAVE Briefing WhatsApp Group Access",
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <div style="background: #14532d; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px;">WAVE Briefing</h1>
                    <p style="color: #bbf7d0; margin: 6px 0 0; font-size: 14px;">Women Agripreneurs Value-creation Empowerment</p>
                </div>
                <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${escapeHtml(String(userName ?? ""))}</strong>,</p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 8px;">
                        Your seat for the <strong>WAVE National Awareness &amp; Opportunity Briefing</strong> has been confirmed.
                    </p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
                        Click the button below to join our exclusive WhatsApp group, where you will receive event updates, venue details, and briefing materials.
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${escapeHtml(String(inviteUrl ?? ""))}"
                           style="background-color: #16a34a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">
                            Join WAVE WhatsApp Group &rarr;
                        </a>
                    </div>
                    <div style="background: #fef9c3; border-left: 4px solid #ca8a04; padding: 12px 16px; border-radius: 4px; margin: 24px 0;">
                        <p style="margin: 0; font-size: 13px; color: #92400e;">
                            &#9888; <strong>Important:</strong> This button can only be clicked once. Do not forward this email &mdash; each registrant receives their own personal invite link.
                        </p>
                    </div>
                    <p style="font-size: 13px; color: #6b7280; margin: 24px 0 0;">
                        This link expires in 7 days. If you need a new invite, please contact our support team.
                    </p>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
                        Easy Sales Export &mdash; Nigeria's Premier Agricultural Export Platform
                    </p>
                </div>
            </div>
        `,
        metadata: { type: "wave_whatsapp_invite" },
    });
}

/**
 * Send Cooperative WhatsApp Group Invite Email
 * Contains a one-time-use button. The inviteUrl encodes a single-use token.
 */
export async function sendCooperativeWhatsAppInviteEmail(
    userEmail: string,
    userName: string,
    inviteUrl: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: "Your EasySales Cooperative WhatsApp Group Access",
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <div style="background: #4c1d95; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px;">EasySales Cooperative</h1>
                    <p style="color: #ddd6fe; margin: 6px 0 0; font-size: 14px;">Your Membership is Active</p>
                </div>
                <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${escapeHtml(String(userName ?? ""))}</strong>,</p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 8px;">
                        Welcome to the <strong>EasySales Cooperative</strong>! Your membership registration and payment have been successfully verified.
                    </p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
                        Click the button below to join our exclusive members-only WhatsApp group for cooperative updates, financial news, and member announcements.
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${escapeHtml(String(inviteUrl ?? ""))}"
                           style="background-color: #7c3aed; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">
                            Join Cooperative WhatsApp Group &rarr;
                        </a>
                    </div>
                    <div style="background: #fef9c3; border-left: 4px solid #ca8a04; padding: 12px 16px; border-radius: 4px; margin: 24px 0;">
                        <p style="margin: 0; font-size: 13px; color: #92400e;">
                            &#9888; <strong>Important:</strong> This button can only be clicked once. Do not forward this email &mdash; access is exclusive to verified, paid members only.
                        </p>
                    </div>
                    <p style="font-size: 13px; color: #6b7280; margin: 24px 0 0;">
                        This link expires in 7 days. If you need a new invite, please contact our support team.
                    </p>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
                        Easy Sales Export &mdash; Nigeria's Premier Agricultural Export Platform
                    </p>
                </div>
            </div>
        `,
        metadata: { type: "cooperative_whatsapp_invite" },
    });
}

/**
 * Send Marketplace Seller Approval Email
 */
export async function sendSellerApprovalEmail(
    userEmail: string,
    userName: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: "🎉 Marketplace Seller Verification Approved!",
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <div style="background: gradient(linear, left top, right bottom, from(#3b82f6), to(#2563eb)); background-color: #2563eb; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Seller Verification Approved!</h1>
                </div>
                <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${escapeHtml(String(userName ?? ""))}</strong>,</p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
                        Congratulations! Your Easy Sales Export Marketplace seller application has been <strong>approved</strong>.
                    </p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
                        You can now start setting up your storefront, adding products, and reaching global buyers.
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${getBaseUrl()}/marketplace/dashboard"
                           style="background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">
                            Go to Seller Dashboard &rarr;
                        </a>
                    </div>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
                        Easy Sales Export &mdash; Nigeria's Premier Agricultural Export Platform
                    </p>
                </div>
            </div>
        `,
        metadata: { type: "seller_approval" },
    });
}

/**
 * Send Marketplace Seller Rejection / Revision Email
 */
export async function sendSellerRejectionEmail(
    userEmail: string,
    userName: string,
    reason: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: "Action Required: Update Your Marketplace Seller Application",
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <div style="background-color: #ef4444; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px;">Application Update Required</h1>
                </div>
                <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${escapeHtml(String(userName ?? ""))}</strong>,</p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
                        Thank you for applying to become a seller on the Easy Sales Export Marketplace.
                    </p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
                        We reviewed your application but we need a few adjustments before we can approve it.
                    </p>
                    <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0;">
                        <p style="margin: 0; font-size: 14px; font-weight: bold; color: #991b1b; mb-2">Admin Feedback:</p>
                        <p style="margin: 4px 0 0; font-size: 14px; color: #7f1d1d;">${escapeHtml(String(reason ?? ""))}</p>
                    </div>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
                        Please log in to your dashboard to edit and resubmit your application.
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${getBaseUrl()}/marketplace/onboarding?edit=true"
                           style="background-color: #1f2937; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">
                            Edit My Application &rarr;
                        </a>
                    </div>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
                        Easy Sales Export &mdash; Nigeria's Premier Agricultural Export Platform
                    </p>
                </div>
            </div>
        `,
        metadata: { type: "seller_rejection", reason },
    });
}

/**
 * Send Academy Manual Enrollment Onboarding Email
 * For users added to the Academy by an admin bypassing the Paystack gateway.
 */
export async function sendAcademyEnrollmentEmail(
    userEmail: string,
    userName: string,
    tier: string
) {
    const formattedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
    
    return sendEmailNotification({
        to: userEmail,
        subject: `Welcome to the Academy (${escapeHtml(String(formattedTier ?? ""))} Package)`,
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <div style="background: gradient(linear, left top, right bottom, from(#16a34a), to(#15803d)); background-color: #16a34a; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Welcome to the Academy!</h1>
                </div>
                <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${escapeHtml(String(userName ?? ""))}</strong>,</p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
                        Great news! An administrator has manually enrolled you into the Academy under the <strong>${escapeHtml(String(formattedTier ?? ""))} Package</strong>.
                    </p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
                        Your account has been fully configured and you can bypass the payment step to access all your courses and resources immediately.
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${getBaseUrl()}/academy/dashboard"
                           style="background-color: #16a34a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">
                            Go to My Academy Dashboard &rarr;
                        </a>
                    </div>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
                        Easy Sales Export &mdash; Nigeria's Premier Agricultural Export Platform
                    </p>
                </div>
            </div>
        `,
        metadata: { type: "academy_enrollment", tier },
    });
}

export async function sendExportProductApprovalEmail(
    userEmail: string,
    userName: string,
    productName: string
) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #0f172a;">Export Product Approved</h2>
            <p>Dear ${escapeHtml(String(userName ?? ""))},</p>
            <p>Great news! Your export product <strong>${escapeHtml(String(productName ?? ""))}</strong> has been reviewed and approved by our administrative team.</p>
            <p>It is now live in the Export Catalog and visible to international buyers.</p>
            <p>Log in to your dashboard to monitor its status and any associated buyer inquiries.</p>
            <br />
            <a href="${getBaseUrl()}/export/products" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">View My Products</a>
            <p style="margin-top: 30px; font-size: 14px; color: #64748b;">
                Best regards,<br/>
                The Easy Sales Export Team
            </p>
        </div>
    `;

    return sendEmailNotification({
        to: userEmail,
        subject: "Your Export Product has been Approved",
        message: html,
        metadata: { type: 'export_product_approval', productName }
    });
}

export async function sendExportProductRejectionEmail(
    userEmail: string,
    userName: string,
    productName: string
) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #0f172a;">Export Product Update</h2>
            <p>Dear ${escapeHtml(String(userName ?? ""))},</p>
            <p>Thank you for submitting your product <strong>${escapeHtml(String(productName ?? ""))}</strong> for the Export Catalog.</p>
            <p>After careful review, we are unable to approve this product for the global catalog at this time. This may be due to missing certifications, incorrect grade formatting, or failure to meet minimum international standards.</p>
            <p>Please review your product details and ensure all requirements are met before submitting a new application.</p>
            <p style="margin-top: 30px; font-size: 14px; color: #64748b;">
                Best regards,<br/>
                The Easy Sales Export Team
            </p>
        </div>
    `;

    return sendEmailNotification({
        to: userEmail,
        subject: "Update on your Export Product Submission",
        message: html,
        metadata: { type: 'export_product_rejection', productName }
    });
}

/**
 * Send Legacy Member Welcome Email
 * Sent to members pre-registered by an admin.
 */
export async function sendLegacyMemberWelcomeEmail(
    userEmail: string,
    userName: string,
    temporaryPassword: string
) {
    return sendEmailNotification({
        to: userEmail,
        subject: 'Welcome to Easy Sales Export - Your Account is Ready',
        message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
                <div style="background-color: #16a34a; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Welcome to the Platform!</h1>
                </div>
                <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${escapeHtml(String(userName ?? ""))}</strong>,</p>
                    <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">
                        An administrator has successfully registered your account on the Easy Sales Export platform.
                    </p>
                    
                    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center;">
                        <p style="font-size: 15px; color: #166534; margin: 0 0 16px; font-weight: bold;">
                            🔐 Action Required: Secure Your Account
                        </p>
                        <p style="font-size: 14px; color: #166534; margin: 0 0 20px;">
                            Your account has been secured with a temporary 6-digit PIN. Please log in using this PIN. You will be immediately prompted to create a new, secure password.
                        </p>
                        <div style="background-color: #ffffff; border: 2px dashed #16a34a; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                            <p style="margin: 0; font-size: 12px; color: #4b5563; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">Your Temporary PIN</p>
                            <p style="margin: 8px 0 0; font-size: 32px; color: #16a34a; font-weight: bold; letter-spacing: 4px;">${escapeHtml(String(temporaryPassword ?? ""))}</p>
                        </div>
                        <a href="${getBaseUrl()}/auth/login"
                           style="display: inline-block; background-color: #16a34a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">
                            Log In Now →
                        </a>
                    </div>

                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                        <h4 style="margin: 0 0 12px; color: #0f172a; font-size: 15px;">How to Access Your Account:</h4>
                        <ol style="margin: 0; padding-left: 20px; color: #374151; font-size: 14px; line-height: 1.8;">
                            <li>Click the "Log In Now" button above.</li>
                            <li>Log in using your email and the 6-digit PIN.</li>
                            <li>Create a new, secure password when prompted.</li>
                            <li>Access your dashboard and begin using the platform.</li>
                        </ol>
                    </div>
                    
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
                        Easy Sales Export — Nigeria's Premier Agricultural Export Platform
                    </p>
                </div>
            </div>
        `,
        metadata: { type: 'legacy_onboarding' },
    });
}

