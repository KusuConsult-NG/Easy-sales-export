import { Resend } from 'resend';
import { supabaseDb as db } from './supabase-db';
import { generateOTP, isOTPExpired, encryptData, decryptData } from './security';
import { claimIdempotencyKey } from './wallet-ledger';
import { toMillis } from './firestore-serialize';

// Lazy Resend factory — env var only available at request time, not build time
const getResend = () => new Resend(process.env.RESEND_API_KEY);
const MFA_COLLECTION = 'mfa_codes';

/**
 * THREE OF THE FOUR FUNCTIONS IN THIS FILE FELL BACK TO A PUBLIC STRING.
 *
 * sendMFACode does the right thing:
 *
 *     const secretKey = process.env.MFA_SECRET_KEY;
 *     if (!secretKey) throw new Error("MFA_SECRET_KEY is not configured");
 *
 * verifyMFACode, storeBackupCodes and verifyBackupCode each did this instead:
 *
 *     process.env.MFA_SECRET_KEY || <a default string hardcoded right here>
 *
 * That literal is committed to this repository. Encrypting a backup code with it
 * is not encryption — anyone who can read the mfa_backup_codes rows can decrypt
 * every recovery code on the platform, and a recovery code is by design the
 * thing that gets you past MFA without the authenticator.
 *
 * All four MFA routes already refuse to run without the key ("FATAL:
 * MFA_SECRET_KEY is not set") and env-validator.ts lists it as required, so in a
 * correctly configured deploy the fallback never fires. That is exactly what
 * makes it dangerous: a missing variable turns silently into worthless
 * encryption instead of a loud failure, and nobody finds out until the codes are
 * needed. Same reasoning as the silent no-op shims closed earlier in this audit.
 *
 * One resolver now, and it throws — matching sendMFACode and the routes.
 */
function requireMfaSecret(): string {
    const secretKey = process.env.MFA_SECRET_KEY;
    if (!secretKey) throw new Error('MFA_SECRET_KEY is not configured');
    return secretKey;
}

/**
 * Newest `createdAt` first.
 *
 * Through toMillis, NOT through String(). The first version of this sort
 * compared `String(doc.data().createdAt)` — and the adapter hands `createdAt`
 * back as a Timestamp object, not the ISO string that was written. Both sides
 * stringified to "[object Object]", localeCompare returned 0, and the sort was a
 * no-op that left the arbitrary order it was written to replace. The test for it
 * failed, which is the only reason it was caught.
 *
 * toMillis is the shared normaliser for exactly this: it handles Date, number,
 * ISO string and Timestamp, and returns 0 for anything it cannot read — so a row
 * with no usable createdAt sorts last rather than winning by accident.
 */
function newestFirst<T extends { data: () => any }>(docs: T[]): T[] {
    return [...docs].sort((a, b) => toMillis(b.data()?.createdAt) - toMillis(a.data()?.createdAt));
}

export interface MFACode {
    id?: string;
    userId: string;
    email: string;
    code: string; // Encrypted
    createdAt: any;
    expiresAt: any;
    verified: boolean;
    attempts: number;
}

/**
 * Send OTP code via email
 */
export async function sendMFACode(email: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Generate 6-digit OTP
        const otp = generateOTP(6);

        // Encrypt OTP before storing
        const encryptedOTP = encryptData(otp, requireMfaSecret());

        // Delete any existing unverified codes for this user
        const existingCodes = await db.collection(MFA_COLLECTION)
            .where('userId', '==', userId)
            .where('verified', '==', false)
            .get();
        for (const doc of existingCodes.docs) {
            await doc.ref.delete();
        }

        // Store encrypted OTP in database
        const expiryMinutes = parseInt(process.env.MFA_OTP_EXPIRY_MINUTES || '10', 10);
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + expiryMinutes);

        await db.collection(MFA_COLLECTION).add({
            userId,
            email,
            code: encryptedOTP,
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString(),
            verified: false,
            attempts: 0,
        });

        // Send email via Resend
        const senderEmail = process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>';
        const { error } = await getResend().emails.send({
            from: senderEmail,
            to: email,
            subject: 'Your Verification Code',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #2563eb;">Easy Sales Export</h2>
                    <p>Your verification code is:</p>
                    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                        <h1 style="color: #1f2937; letter-spacing: 8px; font-size: 36px; margin: 0;">${otp}</h1>
                    </div>
                    <p style="color: #6b7280;">This code will expire in ${expiryMinutes} minutes.</p>
                    <p style="color: #6b7280; font-size: 14px;">If you didn't request this code, please ignore this email.</p>
                </div>
            `,
        });

        if (error) {
            console.error('Resend API Error (MFA):', error);
            return { success: false, error: 'Failed to send verification code. Please try again.' };
        }

        return { success: true };
    } catch (error) {
        console.error('Failed to send MFA code:', error);
        return { success: false, error: 'Failed to send verification code. Please try again.' };
    }
}

/**
 * Verify OTP code
 */
export async function verifyMFACode(
    userId: string,
    code: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // Find unverified code for this user
        const codesSnapshot = await db.collection(MFA_COLLECTION)
            .where('userId', '==', userId)
            .where('verified', '==', false)
            .get();

        if (codesSnapshot.empty) {
            return { success: false, error: 'No verification code found. Please request a new one.' };
        }

        /**
         * The NEWEST unverified code, not an arbitrary one.
         *
         * This took docs[0] from an unordered query. sendMFACode deletes the
         * user's unverified codes before adding a new one, so normally there is
         * exactly one — but two sends that overlap leave two rows, and then
         * docs[0] is whichever PostgREST happened to return first. The user
         * reads the code from the newest email and the check runs against the
         * older row.
         */
        const codeDoc = newestFirst(codesSnapshot.docs)[0];
        const codeDocRef = codeDoc.ref;
        const secretKey = requireMfaSecret();

        const mfaCode = codeDoc.data();

        /**
         * EXPIRY IS THE ONE THE CODE WAS ISSUED WITH.
         *
         * sendMFACode computes `expiresAt` and stores it on the row — and
         * nothing read it. This recomputed the deadline from `createdAt` using
         * whatever MFA_OTP_EXPIRY_MINUTES says AT VERIFY TIME, so the stored
         * field was decoration and the real deadline moved with the environment:
         * lower the variable and codes already in people's inboxes expire early;
         * raise it and codes that were issued as ten-minute codes stay live
         * longer than the email promised.
         *
         * The stored value wins now, with the old recomputation kept as the
         * fallback for rows written before it existed.
         */
        const expiryMinutes = parseInt(process.env.MFA_OTP_EXPIRY_MINUTES || '10', 10);
        const storedExpiry = mfaCode.expiresAt ? new Date(mfaCode.expiresAt) : null;
        const expired = storedExpiry && !Number.isNaN(storedExpiry.getTime())
            ? Date.now() > storedExpiry.getTime()
            : isOTPExpired(new Date(mfaCode.createdAt), expiryMinutes);

        if (expired) {
            await codeDocRef.delete();
            return { success: false, error: 'Verification code has expired. Please request a new one.' };
        }

        // Check attempts (max 3)
        if (mfaCode.attempts >= 3) {
            await codeDocRef.delete();
            return { success: false, error: 'Too many failed attempts. Please request a new code.' };
        }

        // Decrypt and verify code
        const decryptedOTP = decryptData(mfaCode.code, secretKey);

        if (code !== decryptedOTP) {
            // Increment attempts
            await codeDocRef.update({
                attempts: mfaCode.attempts + 1,
            });
            return { success: false, error: 'Invalid verification code. Please try again.' };
        }

        // Mark as verified and delete
        await codeDocRef.delete();
        return { success: true };
    } catch (error: any) {
        console.error('Failed to verify MFA code:', error);
        return { success: false, error: error.message || 'Verification failed. Please try again.' };
    }
}

/**
 * Generate backup codes for MFA
 */
export function generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
        // Generate 8-character backup code
        const code = generateOTP(8);
        codes.push(code.match(/.{1,4}/g)?.join('-') || code); // Format: XXXX-XXXX
    }
    return codes;
}

/**
 * Store backup codes in database (encrypted)
 */
export async function storeBackupCodes(userId: string, codes: string[]): Promise<void> {
    const secretKey = requireMfaSecret();
    const encryptedCodes = codes.map(code => encryptData(code, secretKey));

    await db.collection('mfa_backup_codes').add({
        userId,
        codes: encryptedCodes,
        createdAt: new Date().toISOString(),
        used: [],
    });
}

/**
 * Verify backup code
 */
export async function verifyBackupCode(userId: string, code: string): Promise<{ success: boolean; error?: string }> {
    try {
        const backupCodesSnapshot = await db.collection('mfa_backup_codes')
            .where('userId', '==', userId)
            .get();

        if (backupCodesSnapshot.empty) {
            return { success: false, error: 'No backup codes found' };
        }

        /**
         * The NEWEST set. storeBackupCodes uses .add(), so regenerating codes
         * leaves the old row in place beside the new one — and docs[0] on an
         * unordered query could hand back the set the user no longer holds.
         */
        const backupCodeDoc = newestFirst(backupCodesSnapshot.docs)[0];
        const backupCodesData = backupCodeDoc.data();
        const secretKey = requireMfaSecret();

        // Decrypt all codes and check
        const decryptedCodes = backupCodesData.codes.map((encCode: string) => decryptData(encCode, secretKey));
        const codeIndex = decryptedCodes.indexOf(code);
        const alreadyUsed: number[] = Array.isArray(backupCodesData.used) ? backupCodesData.used : [];

        if (codeIndex === -1 || alreadyUsed.includes(codeIndex)) {
            return { success: false, error: 'Invalid or already used backup code' };
        }

        /**
         * "EACH CAN ONLY BE USED ONCE" — CLAIMED, NOT ASSUMED.
         *
         * This read `used`, checked the index was absent, and then wrote
         * `[...used, codeIndex]`. A read-modify-write with nothing between the
         * read and the write, on the one credential that gets you past MFA
         * without the authenticator.
         *
         * Two requests presenting the SAME backup code together both read a
         * `used` array without the index, both passed the check above, and both
         * returned success — and the second write clobbers the first, so the
         * array records ONE use for two admissions. Single-use is the whole
         * guarantee the setup screen makes about these codes.
         *
         * claimIdempotencyKey settles it in SQL: the first caller claims, every
         * other caller is told the key is held. Keyed on the backup-code
         * DOCUMENT id rather than the user, so regenerating codes — which adds a
         * new row — starts a fresh set of keys instead of inheriting the spent
         * ones from the old set.
         */
        const claim = await claimIdempotencyKey({
            key: `MFA-BACKUP-${backupCodeDoc.id}-${codeIndex}`,
            userId,
            action: 'mfa_backup_code_redeem',
        });

        if (!claim.claimed) {
            return { success: false, error: 'Invalid or already used backup code' };
        }

        // The claim above is the authority; this keeps `used` readable for the
        // screen that tells a member how many codes they have left. Best-effort
        // on purpose — a failure here must not un-spend a code that has already
        // been redeemed.
        try {
            await backupCodeDoc.ref.update({ used: [...alreadyUsed, codeIndex] });
        } catch (recordErr) {
            console.error('Backup code spent but the used-list write failed:', recordErr);
        }

        return { success: true };
    } catch (error) {
        console.error('Failed to verify backup code:', error);
        return { success: false, error: 'Verification failed' };
    }
}

/**
 * TOTP Authenticator App Functions
 */
import { createHmac, timingSafeEqual } from 'crypto';
import QRCode from 'qrcode';

/**
 * Generate TOTP secret for authenticator app
 */
export function generateTOTPSecret(): string {
    // Generate 20-byte random secret and base32 encode
    const buffer = require('crypto').randomBytes(20);
    return base32Encode(buffer);
}

/**
 * Base32 encoding for TOTP secret
 */
function base32Encode(buffer: Buffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
        value = (value << 8) | buffer[i];
        bits += 8;

        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += alphabet[(value << (5 - bits)) & 31];
    }

    return output;
}

/**
 * Base32 decoding for TOTP
 */
function base32Decode(base32: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleanedInput = base32.toUpperCase().replace(/=+$/, '');
    let bits = 0;
    let value = 0;
    const output: number[] = [];

    for (let i = 0; i < cleanedInput.length; i++) {
        const idx = alphabet.indexOf(cleanedInput[i]);
        if (idx === -1) continue;

        value = (value << 5) | idx;
        bits += 5;

        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(output);
}

/**
 * Generate TOTP token for a given window
 */
function generateTOTP(secret: string, window = 0): string {
    const epoch = Math.floor(Date.now() / 1000 / 30) + window;
    const time = Buffer.alloc(8);
    time.writeBigUInt64BE(BigInt(epoch));

    const key = base32Decode(secret);
    const hmac = createHmac('sha1', key);
    hmac.update(time);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0xf;
    const binary =
        ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
}

/**
 * Generate QR code for authenticator app setup
 */
export async function generateTOTPQRCode(email: string, secret: string): Promise<string> {
    const otpauth = `otpauth://totp/Easy%20Sales%20Export:${encodeURIComponent(email)}?secret=${secret}&issuer=Easy%20Sales%20Export`;
    return await QRCode.toDataURL(otpauth);
}

/**
 * Verify TOTP token from authenticator app
 */
export function verifyTOTPToken(token: string, secret: string): boolean {
    try {
        /**
         * Compared with timingSafeEqual, like the cookie MAC at the foot of this
         * file and for the same reason given there: the value comes from the
         * caller, and `===` on strings returns as soon as two characters differ.
         *
         * Lower stakes than the cookie — six digits, a thirty-second window, and
         * every route that reaches here is behind withRateLimit — so this is
         * consistency rather than a hole being closed. But the file already
         * establishes the standard eighty lines down, and there is no reason for
         * the two comparisons to disagree.
         *
         * EVERY window is evaluated, with no early return, so the answer does
         * not leak which window matched either.
         */
        let matched = false;
        for (let window = -1; window <= 1; window++) {
            const expected = generateTOTP(secret, window);
            const a = Buffer.from(token);
            const b = Buffer.from(expected);
            if (a.length === b.length && timingSafeEqual(a, b)) {
                matched = true;
            }
        }
        return matched;
    } catch (error) {
        return false;
    }
}

/**
 * Check if action requires MFA
 */
export function requiresMFA(action: string): boolean {
    const sensitiveActions = [
        'loan_application',
        'loan_approval',
        'withdrawal',
        'fund_release',
        'admin_action',
        'role_change',
        'land_approval',
        'dispute_resolution',
        'escrow_release',
        'seller_approval',
    ];

    return sensitiveActions.includes(action);
}

// ─── The mfa_verified cookie ─────────────────────────────────────────────────

/**
 * Mint and check the value of the `mfa_verified` cookie.
 *
 * WHY THIS EXISTS
 * ---------------
 * /api/auth/mfa/verify set the cookie to the literal string "true". It is
 * httpOnly, so a script cannot write it — but the value says nothing about WHO
 * verified, and the cookie is issued with a wildcard domain (`.example.com`)
 * and a thirty-minute life.
 *
 * Two consequences, both only reachable once something actually reads the
 * cookie — which today nothing does (see the note on requiresMFA below):
 *
 *   A shared browser. User A verifies, signs out, user B signs in within the
 *   half hour. The cookie is still there and still says "true", so B would be
 *   treated as having completed a second factor they never saw. Sign-out
 *   clears a list of cookies by name and this is not one of them.
 *
 *   The wildcard domain. Any subdomain able to set cookies on the parent can
 *   mint "true"; there is nothing to forge because the value carries no claim.
 *
 * Binding it to the user costs one HMAC and removes both. The value is
 * `<userId>.<hmac>`, so a reader can tell whether THIS session's user is the
 * one who verified, and a value lifted from another browser or another account
 * fails the comparison rather than being accepted.
 *
 * MFA_SECRET_KEY is already required by every route in this feature, so this
 * adds no new configuration.
 */
export function issueMfaVerifiedValue(userId: string, secretKey: string): string {
    const mac = createHmac('sha256', secretKey).update(userId).digest('hex');
    return `${userId}.${mac}`;
}

/**
 * Does this cookie value prove that THIS user completed a second factor?
 *
 * Compared with timingSafeEqual rather than `===`. The comparison is against a
 * value an attacker supplies, and a length-varying early return is the classic
 * way to learn a MAC a byte at a time.
 */
export function isMfaVerifiedValueFor(value: string | undefined, userId: string, secretKey: string): boolean {
    if (!value || !userId || !secretKey) return false;

    const expected = issueMfaVerifiedValue(userId, secretKey);
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
}
