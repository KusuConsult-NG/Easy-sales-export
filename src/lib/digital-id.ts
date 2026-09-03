import { encryptData, decryptData, hashData } from './security';
import QRCode from 'qrcode';

/**
 * Digital ID & QR Code System
 * 
 * Generates secure QR codes for user identification
 * Payload: { userId, memberNumber, timestamp, signature }
 */

/**
 *   #344 THERE IS NO DEFAULT KEY.
 *
 *        Both functions below read the key as
 *        `process.env.QR_ENCRYPTION_KEY || 'default-qr-secret-change-in-production'`.
 *        A card signed with the fallback is a card anyone can forge, because
 *        the fallback is in the source. #169 closed exactly this on
 *        MFA_SECRET_KEY — the MFA routes refuse to run without the variable —
 *        and this module was not fixed with it.
 *
 *        Refusing is the only safe answer: security-checks.ts already fails a
 *        production boot whose QR_ENCRYPTION_KEY is missing or weak, and a
 *        development box without the key gets a message that names the
 *        variable instead of a card that looks signed and is not.
 */
function requireQrKey(): string {
    // Both audits added this guard independently, under different names
    // (requireQrKey / requireQrSecretKey) with identical bodies. One survives.
    // The other's note is worth keeping: failing closed here, the way
    // MFA_SECRET_KEY already does in api/auth/mfa/verify/route.ts, means a
    // future direct import cannot silently regress to the same public default.
    const key = process.env.QR_ENCRYPTION_KEY;
    if (!key) {
        throw new Error("QR_ENCRYPTION_KEY is not set; digital ID cards cannot be signed or verified without it");
    }
    return key;
}

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
 * Generate QR code data URL for user
 */
export async function generateDigitalIDQR(
    userId: string,
    memberNumber: string,
    fullName: string,
    email: string,
    role: string
): Promise<string> {
    const secretKey = requireQrKey();
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
    // Outside the try, on purpose: a missing key is a deployment fault and must
    // surface as one, not be folded into "Invalid QR code format".
    const secretKey = requireQrKey();
    try {

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
