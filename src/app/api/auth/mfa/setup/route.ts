import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

// Force server-side execution (prevents build-time crypto errors)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Setup MFA - Generate QR code and recovery codes
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Lazy-load crypto-dependent functions
        const {
            generateTOTPSecret,
            generateTOTPQRCode,
            generateBackupCodes,
            storeBackupCodes
        } = await import("@/lib/mfa");
        const { encryptData } = await import("@/lib/security");

        const secret = generateTOTPSecret();
        const qrCode = await generateTOTPQRCode(session.user.email || "", secret);
        const recoveryCodes = generateBackupCodes(8);

        const secretKey = process.env.MFA_SECRET_KEY || 'default-secret-key-change-in-production';
        const encryptedSecret = encryptData(secret, secretKey);

        // Store encrypted secret (Admin SDK)
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            totpSecret: encryptedSecret,
            mfaEnabled: false,
            updatedAt: new Date(),
        });

        await storeBackupCodes(session.user.id, recoveryCodes);

        return NextResponse.json({
            success: true,
            qrCode,
            secret,
            recoveryCodes,
        });
    } catch (error: any) {
        logger.error("MFA setup error:", error);
        return NextResponse.json(
            { success: false, error: "Setup failed" },
            { status: 500 }
        );
    }
}
