'use server';

import { logger } from '@/lib/logger';
import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
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

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return { success: false, error: 'Invalid email format' };
        }

        // Use Firebase Auth REST API to send the built-in password reset email
        // This completely bypasses Resend domain verification issues and custom token management
        const response = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestType: 'PASSWORD_RESET',
                    email: email,
                }),
            }
        );

        if (!response.ok) {
            const data = await response.json();
            if (data.error && data.error.message === 'EMAIL_NOT_FOUND') {
                // For security, do not reveal that the email does not exist.
                return { success: true, error: undefined };
            }
            logger.error('Firebase Auth Password Reset Error:', data.error);
            return {
                success: false,
                error: 'Failed to send reset email. Please try again later.'
            };
        }

        return {
            success: true,
            error: undefined
        };
    } catch (error) {
        logger.error('Failed to send reset email:', error);
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
        const snapshot = await db.collection(COLLECTIONS.PASSWORD_RESETS)
            .where('token', '==', token)
            .where('used', '==', false)
            .get();

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
            // Find user again to be sure (since resetData.email is trusted from DB)
            const user = await auth.getUserByEmail(resetData.email);
            await auth.updateUser(user.uid, {
                password: password
            });
        } catch (error) {
            logger.error('Failed to update password:', error);
            return { success: false, error: 'Failed to update password' };
        }

        // Mark token as used
        await db.collection(COLLECTIONS.PASSWORD_RESETS).doc(resetDoc.id).update({
            used: true,
            usedAt: FieldValue.serverTimestamp()
        });

        return {
            success: true,
            error: undefined
        };
    } catch (error) {
        logger.error('Password reset failed:', error);
        return {
            success: false,
            error: 'Password reset failed. Please try again.'
        };
    }
}
