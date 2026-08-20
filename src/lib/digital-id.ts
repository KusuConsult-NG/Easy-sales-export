import { encryptData, decryptData, hashData } from './security';
import QRCode from 'qrcode';

/**
 * Digital ID & QR Code System
 * 
 * Generates secure QR codes for user identification
 * Payload: { userId, memberNumber, timestamp, signature }
 */

export interface DigitalIDPayload {
    userId: string;
    memberNumber: string;
    fullName: string;
    email: string;
    role: string;
    timestamp: number;
    expiresAt: number;
    signature: string;
}

export interface QRVerificationResult {
    valid: boolean;
    payload?: DigitalIDPayload;
    error?: string;
}

/**
 * Both functions below used to fall back to the literal string
 * 'default-qr-secret-change-in-production' whenever QR_ENCRYPTION_KEY was
 * unset. That fallback is public — it is this file, in a public repository —
 * so a QR code signed or checked against it carries no security value: anyone
 * can compute the same signature offline.
 *
 * It also could not have been fixed by setting the env var everywhere it
 * matters, because verifyDigitalIDQR was called directly from a Client
 * Component (src/app/verify-id/page.tsx). Next.js does not expose
 * non-NEXT_PUBLIC_ variables to client bundles, so `process.env.QR_ENCRYPTION_KEY`
 * was `undefined` there unconditionally — every build shipped the fallback
 * string itself into the browser bundle (confirmed by grepping
 * .next/static/chunks/app/verify-id/page-*.js for it). That page now calls the
 * server-side /api/qr/verify route instead, as its sibling
 * verify-id/scan/page.tsx already did.
 *
 * Failing closed here, the way MFA_SECRET_KEY already does in
 * api/auth/mfa/verify/route.ts, means a future direct import cannot silently
 * regress to the same public secret.
 */
function requireQrSecretKey(): string {
    const key = process.env.QR_ENCRYPTION_KEY;
    if (!key) {
        throw new Error('QR_ENCRYPTION_KEY is not set.');
    }
    return key;
}

/**
 * Generate QR code data URL for user
 */
export async function generateDigitalIDQR(
    userId: string,
    memberNumber: string,
    fullName: string,
    email: string,
    role: string
): Promise<string> {
    const secretKey = requireQrSecretKey();
    const expiryDays = parseInt(process.env.QR_CODE_EXPIRY_DAYS || '365', 10);

    const timestamp = Date.now();
    const expiresAt = timestamp + (expiryDays * 24 * 60 * 60 * 1000);

    // Create payload
    const payload: Omit<DigitalIDPayload, 'signature'> = {
        userId,
        memberNumber,
        fullName,
        email,
        role,
        timestamp,
        expiresAt,
    };

    // Generate signature (hash of payload + secret)
    const signatureData = `${userId}${memberNumber}${timestamp}${expiresAt}${secretKey}`;
    const signature = hashData(signatureData);

    const fullPayload: DigitalIDPayload = {
        ...payload,
        signature,
    };

    // Encrypt entire payload
    const encryptedPayload = encryptData(JSON.stringify(fullPayload), secretKey);

    // Generate QR code
    const qrDataUrl = await QRCode.toDataURL(encryptedPayload, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        width: 300,
        margin: 2,
    });

    return qrDataUrl;
}

/**
 * Verify and decode QR code
 */
export function verifyDigitalIDQR(encryptedData: string): QRVerificationResult {
    try {
        const secretKey = requireQrSecretKey();

        // Decrypt payload
        const decryptedData = decryptData(encryptedData, secretKey);
        const payload: DigitalIDPayload = JSON.parse(decryptedData);

        // Verify signature
        const signatureData = `${payload.userId}${payload.memberNumber}${payload.timestamp}${payload.expiresAt}${secretKey}`;
        const expectedSignature = hashData(signatureData);

        if (payload.signature !== expectedSignature) {
            return {
                valid: false,
                error: 'Invalid QR code signature',
            };
        }

        // Check expiry
        if (Date.now() > payload.expiresAt) {
            return {
                valid: false,
                error: 'QR code has expired',
            };
        }

        return {
            valid: true,
            payload,
        };
    } catch (error) {
        console.error('QR verification error:', error);
        return {
            valid: false,
            error: error instanceof Error && error.message === 'QR_ENCRYPTION_KEY is not set.'
                ? 'Service configuration error'
                : 'Invalid QR code format',
        };
    }
}

/**
 * Format member number (ESE-YYYY-XXXXX)
 */
export function formatMemberNumber(userId: string, createdAt: Date): string {
    const year = createdAt.getFullYear();
    const sequence = userId.substring(0, 5).toUpperCase();
    return `ESE-${year}-${sequence}`;
}

/**
 * Generate Digital ID card data for download
 */
export interface DigitalIDCard {
    userId: string;
    memberNumber: string;
    fullName: string;
    email: string;
    role: string;
    memberSince: Date;
    qrCodeDataUrl: string;
    issuedAt: Date;
    expiresAt: Date;
}

export async function generateDigitalIDCard(
    userId: string,
    memberNumber: string,
    fullName: string,
    email: string,
    role: string,
    memberSince: Date
): Promise<DigitalIDCard> {
    const qrCodeDataUrl = await generateDigitalIDQR(userId, memberNumber, fullName, email, role);

    const expiryDays = parseInt(process.env.QR_CODE_EXPIRY_DAYS || '365', 10);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + (expiryDays * 24 * 60 * 60 * 1000));

    return {
        userId,
        memberNumber,
        fullName,
        email,
        role,
        memberSince,
        qrCodeDataUrl,
        issuedAt,
        expiresAt,
    };
}
