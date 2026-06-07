"use server";

import { logger } from '@/lib/logger';
import { db, adminAuth } from '@/lib/firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from 'firebase-admin/firestore';
import crypto from 'crypto';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export type SendResetEmailState = 
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any };

export type ResetPasswordState = 
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any };

/**
 * Generate a secure random token for password reset
 */
function generateResetToken(): string { return crypto.randomBytes(32).toString('hex'); }

/**
 * Send password reset email to user
 * Creates a reset token and sends email via Resend
 */
export async function sendResetEmailAction(
    prevState: SendResetEmailState,
    formData: FormData
): Promise<SendResetEmailState> { try {
        const rawEmail = (formData.get('email') as string | null)?.trim() ?? "";

        if (!rawEmail) {
            return { success: false as const, error: 'Email is required', data: null };
        }
        
        const email = rawEmail.trim().toLowerCase();

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) { return { success: false as const, error: 'Invalid email format', data: null };
        }

        const auth = adminAuth;
        try { await auth.getUserByEmail(email);
        } catch (error) { // For security, don't reveal if email exists or not
            return { success: true as const, error: null
 };
        }

        // Generate reset token
        const token = generateResetToken();
        const expiry = Date.now() + 3600000; // 1 hour from now

        // Store reset token in Firestore
        await db.collection(COLLECTIONS.PASSWORD_RESETS).add({ email,
            token,
            expiry,
            used: false,
            createdAt: FieldValue.serverTimestamp()
        });

        // Determine the base URL — in production use the canonical domain
        let baseUrl = process.env.NEXT_PUBLIC_URL
            || process.env.NEXTAUTH_URL
            || 'https://www.easysalesexport.com';

        try {
            const { headers } = await import("next/headers");
            const headersList = await headers();
            const host = headersList.get("x-forwarded-host") || headersList.get("host") || "";
            const protocol = headersList.get("x-forwarded-proto") || "https";
            if (host) {
                baseUrl = `${protocol}://${host}`;
            }
        } catch (e) {
            // Ignore headers error in environments where next/headers is not available
        }

        // If the baseUrl is the apex domain, make sure to normalize it to www.
        if (baseUrl.includes("://easysalesexport.com")) {
            baseUrl = baseUrl.replace("://easysalesexport.com", "://www.easysalesexport.com");
        }

        const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

        // Send email via Resend (using platform's verified domain)

        const { error } = await resend.emails.send({
            from: 'Easy Sales Export <noreply@easysalesexport.com>',
            to: email,
            subject: 'Reset Your Password - Easy Sales Export',
            html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Password Reset</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f8fafc;">
  <div style="background: white; border-radius: 16px; padding: 40px; border: 1px solid #e2e8f0;">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: #0f172a; font-size: 24px; margin: 0;">Password Reset Request</h1>
      <p style="color: #64748b; margin-top: 8px;">Easy Sales Export</p>
    </div>
    <p style="color: #334155;">You requested a password reset for your Easy Sales Export account.
      Click the button below to set a new password:</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${resetUrl}"
         style="background: #3b5bdb; color: white; padding: 14px 28px; border-radius: 10px;
                text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
        Reset My Password
      </a>
    </div>
    <p style="color: #64748b; font-size: 14px;">
      This link expires in <strong>1 hour</strong>. If you did not request this, you can safely ignore this email.
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #94a3b8; font-size: 12px; text-align: center;">
      If the button doesn't work, copy this link: ${resetUrl}
    </p>
  </div>
</body>
</html>
            `
        });

        if (error) { logger.error('Resend API Error (password reset):', error);
            return { success: false as const, error: 'Failed to send reset email. Please try again later.', data: null };
        }

        return { success: true as const, error: null
 };
    } catch (error) { logger.error('Failed to send reset email:', error);
        return { success: false as const, error: 'Failed to send reset email. Please try again later.', data: null };
    }
}

/**
 * Reset user password using token
 */
export async function resetPasswordAction(
    prevState: ResetPasswordState,
    formData: FormData
): Promise<ResetPasswordState> { try {
        const token = (formData.get('token') as string | null)?.trim() ?? "";
        const password = (formData.get('password') as string | null) ?? "";
        const confirmPassword = (formData.get('confirmPassword') as string | null) ?? "";

        // Validation
        if (!token || !password || !confirmPassword) {
            return { success: false as const, error: 'All fields are required', data: null };
        }

        if (password !== confirmPassword) { return { success: false as const, error: 'Passwords do not match', data: null };
        }

        if (password.length < 8) { return { success: false as const, error: 'Password must be at least 8 characters', data: null };
        }

        // Find and validate token in Firestore
        const snapshot = await db.collection(COLLECTIONS.PASSWORD_RESETS)
            .where('token', '==', token)
            .where('used', '==', false)
            .get();

        if (snapshot.empty) { return { success: false as const, error: 'Invalid or expired reset token', data: null };
        }

        const resetDoc = snapshot.docs[0];
        const resetData = resetDoc.data();

        // Check if token has expired
        if (Date.now() > resetData.expiry) { return { success: false as const, error: 'Reset token has expired', data: null };
        }

        // Update password in Firebase Auth
        const auth = adminAuth;
        try { // Find user again to be sure (since resetData.email is trusted from DB)
            const user = await auth.getUserByEmail(resetData.email);
            await auth.updateUser(user.uid, {
                password: password
            });
        } catch (error) { logger.error('Failed to update password:', error);
            return { success: false as const, error: 'Failed to update password', data: null };
        }

        // Also clear requiresPasswordChange if it exists (e.g. for legacy members)
        try {
            const auth = adminAuth;
            const user = await auth.getUserByEmail(resetData.email);
            await db.collection(COLLECTIONS.USERS).doc(user.uid).update({
                requiresPasswordChange: FieldValue.delete()
            });
        } catch (updateErr) {
            // Ignore if field doesn't exist
        }

        // Mark token as used
        await db.collection(COLLECTIONS.PASSWORD_RESETS).doc(resetDoc.id).update({ used: true,
            usedAt: FieldValue.serverTimestamp()
        });

        return { success: true as const, error: null
 };
    } catch (error) { logger.error('Password reset failed:', error);
        return { success: false as const, error: 'Password reset failed. Please try again.', data: null };
    }
}
