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
 *        Refusing is the only safe answer, and a development box without the
 *        key gets a message that names the variable instead of a card that
 *        looks signed and is not.
 *
 *   #441 CORRECTS WHAT THIS COMMENT USED TO CLAIM. It said "security-checks.ts
 *        already fails a production boot whose QR_ENCRYPTION_KEY is missing or
 *        weak". It does not, and never did: validateProductionSecrets writes a
 *        console.error and returns — its own source says it must NEVER throw,
 *        because it runs at module scope in the root layout. layout.tsx also
 *        wraps the call in a try/catch that only warns.
 *
 *        So the refusal below is not a second line of defence behind a boot
 *        check. IT IS THE ONLY LINE. That makes it more important, not less,
 *        which is why the claim is corrected rather than deleted.
 */
function requireQrKey(): string {
    const key = process.env.QR_ENCRYPTION_KEY;
    if (!key) {
        throw new Error("QR_ENCRYPTION_KEY is not set. Digital ID cards cannot be signed or verified without it.");
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
 *
 *   MERGE NOTE. This branch and main (PR #221) found and fixed the same defect
 *   independently, with differently-named helpers: requireQrKey here,
 *   requireQrSecretKey there. Merging kept ONE, and kept this branch's, for two
 *   reasons that are behavioural rather than stylistic:
 *
 *     - its message names the consequence ("digital ID cards cannot be signed or
 *       verified without it") rather than only the missing variable;
 *   The note originally written here also claimed this branch's placement of the
 *   call — outside the try in verifyDigitalIDQR — was the better of the two.
 *   THAT WAS WRONG, and the merge went main's way instead: see the correction at
 *   verifyDigitalIDQR. Throwing out of a verifier that a public route calls
 *   turns a config mistake into an uninterpretable 500, where main's fails
 *   closed with an error a caller can tell apart from a bad card.
 *
 *   The reasoning main's version carried is preserved above; only the duplicate
 *   implementation is gone.
 */

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
    /**
     *   MERGE CORRECTION. This branch put requireQrKey() OUTSIDE the try, so a
     *   missing key threw out of the verifier. The reasoning was that a
     *   deployment fault must surface as one rather than be folded into
     *   "Invalid QR code format" — right about the goal, wrong about the means.
     *
     *   /api/qr/verify calls this on a PUBLIC page. Throwing turns a
     *   configuration mistake into a 500 the caller cannot interpret, and main's
     *   fix (PR #221) achieved the same separation better: fail closed, and
     *   return an error string that is distinguishable from a bad card. That is
     *   what is kept here, and its test pins it.
     */
    let secretKey: string;
    try {
        secretKey = requireQrKey();
    } catch {
        return { valid: false, error: 'Service configuration error' };
    }

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
