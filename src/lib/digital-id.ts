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
 * Generate QR code data URL for user
 */
export async function generateDigitalIDQR(
    userId: string,
    memberNumber: string,
    fullName: string,
    email: string,
    role: string
): Promise<string> {
    const secretKey = process.env.QR_ENCRYPTION_KEY || 'default-qr-secret-change-in-production';
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
        const secretKey = process.env.QR_ENCRYPTION_KEY || 'default-qr-secret-change-in-production';

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
            error: 'Invalid QR code format',
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
