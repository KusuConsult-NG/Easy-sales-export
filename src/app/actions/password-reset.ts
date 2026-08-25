"use server";

import { logger } from '@/lib/logger';
import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import crypto from 'crypto';
import { Resend } from 'resend';
import { claimIdempotencyKey } from '@/lib/wallet-ledger';
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { getBaseUrl } from '@/lib/email-notifications';

const resend = new Resend(process.env.RESEND_API_KEY);

/** See sendResetEmailAction for why this bucket and not the login one. */
const resetLimiter = rateLimit(rateLimitConfig.contactForm);

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

        // Somebody else's inbox is not a free megaphone.
        //
        // This endpoint is unauthenticated, sends a real email through Resend on
        // every call, and had no limit of any kind — so one address could be
        // mailed as fast as requests could be made, at the platform's cost and
        // the recipient's expense.
        //
        // Keyed on the email rather than the caller, because the caller is
        // anonymous and the address is what is being abused. The contactForm
        // bucket is 30 per hour, which is far above anyone's genuine need to
        // reset a password and far below a usable flood.
        //
        // Deliberately NOT the login bucket: that is keyed by email too, and
        // spending it here would let reset requests lock the same person out of
        // signing in.
        const limit = await resetLimiter.check(`password-reset:${email}`);
        if (!limit.success) {
            // Same shape as the unknown-address reply below, so the limit does
            // not become an oracle for which addresses are registered.
            return { success: true as const, error: null };
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

        /**
         *   #261 THIS LINK POINTED WHEREVER THE REQUESTER SAID.
         *
         *        The base URL was picked from configuration — under the comment
         *        "in production use the canonical domain" — and then overridden
         *        with the REQUEST HEADERS:
         *
         *            const host = headersList.get("x-forwarded-host")
         *                || headersList.get("host") || "";
         *            if (host) baseUrl = `${protocol}://${host}`;
         *
         *        A Host header is not a fact about a request. It is a string
         *        the client writes, and the platform routes on TLS/SNI rather
         *        than on it, so a request for our certificate can carry any
         *        Host at all.
         *
         *        THE ATTACK IS ACCOUNT TAKEOVER AND NEEDS NOTHING ELSE. POST
         *        the forgot-password form for somebody else's address with
         *        `Host: attacker.example`, and the VICTIM receives a genuine
         *        email — real sender, real template — containing
         *
         *            https://attacker.example/auth/reset-password?token=<VALID>
         *
         *        They click it, the token reaches the attacker, and the
         *        attacker resets their password. The victim did nothing wrong.
         *
         *        The fix is the function that already existed:
         *        email-notifications.ts owns getBaseUrl(), which reads
         *        configuration only, never a header, and normalises module
         *        domains and the apex back to the canonical www host — so a
         *        member resetting from easysalescooperative.com still gets a
         *        link that works. Every other email on the platform uses it.
         *        This one rolled its own and read the header: two copies of one
         *        rule with the wrong one deciding, and here that costs an
         *        account.
         */
        const baseUrl = getBaseUrl();

        const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

        // Send email via Resend (using platform's verified domain)

        const senderEmail = process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>';
        const { error } = await resend.emails.send({
            from: senderEmail,
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

        // The same bar as registration and as changePasswordAction.
        //
        // This checked length alone, so a reset was the weakest of the three
        // ways to set a password on this platform — and the one reachable
        // without knowing the old one.
        const { passwordPolicySchema } = await import("@/lib/schemas");
        const policy = passwordPolicySchema.safeParse(password);
        if (!policy.success) {
            return { success: false as const, error: policy.error.issues[0].message, data: null };
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

        // Claim the token BEFORE changing anything.
        //
        // It used to be marked used at the very end, after the password write
        // and after clearing requiresPasswordChange. A failure anywhere in
        // between left a valid reset token in the database — and a reset link
        // that still works after it has been used is worth more to whoever
        // intercepted the email than to the person who requested it.
        //
        // Claiming first means a failure after this point costs a wasted token
        // and a second request. That is the cheaper mistake.
        const claim = await claimIdempotencyKey({
            key: `password-reset:${resetDoc.id}`,
            action: "password_reset",
        });

        if (!claim.claimed) {
            return { success: false as const, error: 'Invalid or expired reset token', data: null };
        }

        await db.collection(COLLECTIONS.PASSWORD_RESETS).doc(resetDoc.id).update({
            used: true,
            usedAt: FieldValue.serverTimestamp(),
        });

        // Write the new password to the store that authenticates logins.
        //
        // This updated Firebase Auth and only Firebase Auth. lib/auth.ts
        // authenticates against SUPABASE first and treats Firebase as a legacy
        // fallback — the same split fixed for changePasswordAction in #108, in
        // the path that matters more. A reset is what somebody uses when they
        // are locked out or believe their password is compromised.
        //
        // With Supabase still holding the old secret:
        //   old password  Supabase accepts. Login succeeds.
        //   new password  Supabase rejects, the Firebase fallback accepts, then
        //                 tries to provision the user in Supabase, gets
        //                 "already exists" and throws auth/invalid-credential.
        //
        // So the reset did nothing, the old password kept working, and the
        // person was told to sign in with the new one.
        //
        // Supabase is authoritative here and its failure is reported as a
        // failure. Firebase is updated afterwards, best-effort, because the
        // fallback would otherwise keep accepting the superseded password.
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
            return { success: false as const, error: 'Service configuration error. Please contact support.', data: null };
        }

        const { supabaseAdmin } = await import("@/lib/supabase");

        // getUserByEmail is Firebase's, and an account created after the
        // migration may have no Firebase record at all — registerAction catches
        // that failure and logs a warning. So the Supabase id is resolved from
        // the user profile, falling back to Firebase only if needed.
        let targetUserId: string | null = null;
        // The PROFILE document id, which is what a session's token.id holds —
        // distinct from targetUserId, which may be the Supabase Auth id.
        let profileDocId: string | null = null;
        try {
            const profileSnap = await db.collection(COLLECTIONS.USERS)
                .where("email", "==", resetData.email)
                .limit(1)
                .get();
            if (!profileSnap.empty) {
                const profile = profileSnap.docs[0];
                profileDocId = profile.id;
                targetUserId = profile.data()?.supabaseAuthId || profile.id;
            }
        } catch (lookupErr) {
            logger.warn('[reset] profile lookup failed:', lookupErr as Error);
        }

        if (!targetUserId) {
            try {
                const fbUser = await adminAuth.getUserByEmail(resetData.email);
                targetUserId = fbUser.uid;
            } catch {
                return { success: false as const, error: 'Failed to update password', data: null };
            }
        }

        const { error: sbUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
            targetUserId,
            { password }
        );

        if (sbUpdateError) {
            logger.error('[reset] Supabase Auth password update failed:', sbUpdateError);
            return { success: false as const, error: 'Failed to update password', data: null };
        }

        try {
            const fbUser = await adminAuth.getUserByEmail(resetData.email);
            await adminAuth.updateUser(fbUser.uid, { password });
        } catch (fbErr: any) {
            logger.warn('[reset] legacy Firebase password update skipped:', fbErr?.message);
        }

        // End the sessions that were opened with the old password.
        //
        // NOTHING DID THIS. `passwordChangedAt` is written by
        // changePasswordAction and read by no one, and this action did not even
        // write that. Sessions are stateless JWTs with an 8-hour maxAge, so
        // somebody holding a stolen session cookie kept full access for up to
        // eight hours AFTER the victim did the one thing the platform tells
        // people to do about a compromise. The reset changed the password and
        // left the intruder signed in.
        //
        // `sessionsValidFrom` is the revocation point: the jwt callback in
        // lib/auth.ts compares it against when each session was authenticated
        // and refuses the older ones, within its existing 2-minute profile
        // re-read.
        //
        // Best-effort, and deliberately after the password writes. The password
        // is already changed in both stores by this line; failing the whole
        // reset because a revocation stamp did not write would tell somebody
        // their password had not changed when it had. A failure here is logged
        // loudly because it leaves old sessions alive.
        if (profileDocId) {
            try {
                await db.collection(COLLECTIONS.USERS).doc(profileDocId).update({
                    sessionsValidFrom: Date.now(),
                    passwordChangedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } catch (revokeErr: any) {
                logger.error('[reset] password changed but existing sessions were NOT revoked', {
                    profileDocId,
                    error: revokeErr?.message,
                });
            }
        } else {
            logger.error('[reset] password changed but no profile found to revoke sessions on', {
                email: resetData.email,
            });
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

        return { success: true as const, error: null
 };
    } catch (error) { logger.error('Password reset failed:', error);
        return { success: false as const, error: 'Password reset failed. Please try again.', data: null };
    }
}
