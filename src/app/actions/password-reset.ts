'use server';

import { db } from '@/lib/firebase';
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'crypto';

export interface SendResetEmailState {
    success: boolean;
    error?: string;
}

export interface ResetPasswordState {
    success: boolean;
    error?: string;
}

/**
 * Generate a secure random token for password reset
 */
function generateResetToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Send password reset email to user
 * Creates a reset token and sends email via Resend
 */
export async function sendResetEmailAction(
    prevState: SendResetEmailState,
    formData: FormData
): Promise<SendResetEmailState> {
    try {
        const email = formData.get('email') as string;

        if (!email) {
            return { success: false, error: 'Email is required' };
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return { success: false, error: 'Invalid email format' };
        }

        // Check if user exists in Firebase Auth
        const auth = getAuth();
        try {
            await auth.getUserByEmail(email);
        } catch (error) {
            // For security, don't reveal if email exists or not
            return {
                success: true,
                error: undefined
            };
        }

        // Generate reset token
        const token = generateResetToken();
        const expiry = Date.now() + 3600000; // 1 hour from now

        // Store reset token in Firestore
        await addDoc(collection(db, 'password_resets'), {
            email,
            token,
            expiry,
            used: false,
            createdAt: new Date()
        });

        // Send email using Resend
        const resetUrl = `${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}`;

        // Send email via Resend
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        await resend.emails.send({
            from: 'Easy Sales Export <onboarding@resend.dev>',
            to: email,
            subject: 'Reset Your Password - Easy Sales Export',
            html: `
                <h2>Password Reset Request</h2>
                <p>Click the link below to reset your password:</p>
                <a href="${resetUrl}">Reset Password</a>
                <p>This link will expire in 1 hour.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        });

        console.log(`Password reset email sent to: ${email}`);

        return {
            success: true,
            error: undefined
        };
    } catch (error) {
        console.error('Failed to send reset email:', error);
        return {
            success: false,
            error: 'Failed to send reset email. Please try again later.'
        };
    }
}

/**
 * Reset user password using token
 */
export async function resetPasswordAction(
    prevState: ResetPasswordState,
    formData: FormData
): Promise<ResetPasswordState> {
    try {
        const token = formData.get('token') as string;
        const password = formData.get('password') as string;
        const confirmPassword = formData.get('confirmPassword') as string;

        // Validation
        if (!token || !password || !confirmPassword) {
            return { success: false, error: 'All fields are required' };
        }

        if (password !== confirmPassword) {
            return { success: false, error: 'Passwords do not match' };
        }

        if (password.length < 8) {
            return { success: false, error: 'Password must be at least 8 characters' };
        }

        // Find and validate token in Firestore
        const resetsRef = collection(db, 'password_resets');
        const q = query(
            resetsRef,
            where('token', '==', token),
            where('used', '==', false)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, error: 'Invalid or expired reset token' };
        }

        const resetDoc = snapshot.docs[0];
        const resetData = resetDoc.data();

        // Check if token has expired
        if (Date.now() > resetData.expiry) {
            return { success: false, error: 'Reset token has expired' };
        }

        // Update password in Firebase Auth
        const auth = getAuth();
        try {
            const user = await auth.getUserByEmail(resetData.email);
            await auth.updateUser(user.uid, {
                password: password
            });
        } catch (error) {
            console.error('Failed to update password:', error);
            return { success: false, error: 'Failed to update password' };
        }

        // Mark token as used
        await updateDoc(doc(db, 'password_resets', resetDoc.id), {
            used: true,
            usedAt: new Date()
        });

        return {
            success: true,
            error: undefined
        };
    } catch (error) {
        console.error('Password reset failed:', error);
        return {
            success: false,
            error: 'Password reset failed. Please try again.'
        };
    }
}
