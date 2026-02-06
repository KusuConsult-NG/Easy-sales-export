import { Resend } from 'resend';
import { getFirestore, collection, addDoc, query, where, getDocs, deleteDoc, updateDoc, Timestamp } from 'firebase/firestore';
import app from './firebase';
import { generateOTP, isOTPExpired, encryptData, decryptData } from './security';

const resend = new Resend(process.env.RESEND_API_KEY);
const db = getFirestore(app);
const MFA_COLLECTION = 'mfa_codes';

export interface MFACode {
    id?: string;
    userId: string;
    email: string;
    code: string; // Encrypted
    createdAt: Timestamp;
    expiresAt: Timestamp;
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
        const secretKey = process.env.MFA_SECRET_KEY || 'default-secret-key-change-in-production';
        const encryptedOTP = encryptData(otp, secretKey);

        // Delete any existing unverified codes for this user
        const existingCodesQuery = query(
            collection(db, MFA_COLLECTION),
            where('userId', '==', userId),
            where('verified', '==', false)
        );
        const existingCodes = await getDocs(existingCodesQuery);
        for (const doc of existingCodes.docs) {
            await deleteDoc(doc.ref);
        }

        // Store encrypted OTP in Firestore
        const expiryMinutes = parseInt(process.env.MFA_OTP_EXPIRY_MINUTES || '10', 10);
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + expiryMinutes);

        await addDoc(collection(db, MFA_COLLECTION), {
            userId,
            email,
            code: encryptedOTP,
            createdAt: Timestamp.now(),
            expiresAt: Timestamp.fromDate(expiresAt),
            verified: false,
            attempts: 0,
        });

        // Send email via Resend
        await resend.emails.send({
            from: 'Easy Sales Export <noreply@easysalesexport.com>',
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
        const codesQuery = query(
            collection(db, MFA_COLLECTION),
            where('userId', '==', userId),
            where('verified', '==', false)
        );
        const codesSnapshot = await getDocs(codesQuery);

        if (codesSnapshot.empty) {
            return { success: false, error: 'No verification code found. Please request a new one.' };
        }

        const codeDoc = codesSnapshot.docs[0];
        const mfaCode = codeDoc.data() as MFACode;

        // Check if code is expired
        const expiryMinutes = parseInt(process.env.MFA_OTP_EXPIRY_MINUTES || '10', 10);
        if (isOTPExpired(mfaCode.createdAt.toDate(), expiryMinutes)) {
            await deleteDoc(codeDoc.ref);
            return { success: false, error: 'Verification code has expired. Please request a new one.' };
        }

        // Check attempts (max 3)
        if (mfaCode.attempts >= 3) {
            await deleteDoc(codeDoc.ref);
            return { success: false, error: 'Too many failed attempts. Please request a new code.' };
        }

        // Decrypt and verify code
        const secretKey = process.env.MFA_SECRET_KEY || 'default-secret-key-change-in-production';
        const decryptedOTP = decryptData(mfaCode.code, secretKey);

        if (code !== decryptedOTP) {
            // Increment attempts
            await updateDoc(codeDoc.ref, {
                attempts: mfaCode.attempts + 1,
            });

            return { success: false, error: 'Invalid verification code. Please try again.' };
        }

        // Mark as verified and delete
        await deleteDoc(codeDoc.ref);

        return { success: true };
    } catch (error) {
        console.error('Failed to verify MFA code:', error);
        return { success: false, error: 'Verification failed. Please try again.' };
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
 * Store backup codes in Firestore (encrypted)
 */
export async function storeBackupCodes(userId: string, codes: string[]): Promise<void> {
    const secretKey = process.env.MFA_SECRET_KEY || 'default-secret-key-change-in-production';
    const encryptedCodes = codes.map(code => encryptData(code, secretKey));

    await addDoc(collection(db, 'mfa_backup_codes'), {
        userId,
        codes: encryptedCodes,
        createdAt: Timestamp.now(),
        used: [],
    });
}

/**
 * Verify backup code
 */
export async function verifyBackupCode(userId: string, code: string): Promise<{ success: boolean; error?: string }> {
    try {
        const backupCodesQuery = query(
            collection(db, 'mfa_backup_codes'),
            where('userId', '==', userId)
        );
        const backupCodesSnapshot = await getDocs(backupCodesQuery);

        if (backupCodesSnapshot.empty) {
            return { success: false, error: 'No backup codes found' };
        }

        const backupCodeDoc = backupCodesSnapshot.docs[0];
        const backupCodesData = backupCodeDoc.data();
        const secretKey = process.env.MFA_SECRET_KEY || 'default-secret-key-change-in-production';

        // Decrypt all codes and check
        const decryptedCodes = backupCodesData.codes.map((encCode: string) => decryptData(encCode, secretKey));
        const codeIndex = decryptedCodes.indexOf(code);

        if (codeIndex === -1 || backupCodesData.used.includes(codeIndex)) {
            return { success: false, error: 'Invalid or already used backup code' };
        }

        // Mark code as used
        await updateDoc(backupCodeDoc.ref, {
            used: [...backupCodesData.used, codeIndex],
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to verify backup code:', error);
        return { success: false, error: 'Verification failed' };
    }
}

/**
 * TOTP Authenticator App Functions
 */

import { createHmac } from 'crypto';
import QRCode from 'qrcode';

/**
 * Generate TOTP secret for authenticator app
 */
export function generateTOTPSecret(): string {
    // Generate 20-byte random secret and base32 encode
    const buffer = Buffer.from(Array.from({ length: 20 }, () => Math.floor(Math.random() * 256)));
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
        // Check current window and ±1 for clock skew tolerance
        for (let window = -1; window <= 1; window++) {
            const expected = generateTOTP(secret, window);
            if (token === expected) {
                return true;
            }
        }
        return false;
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
