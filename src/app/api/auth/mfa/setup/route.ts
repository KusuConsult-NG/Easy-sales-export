import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withRateLimit } from "@/lib/rate-limit";
import { FieldValue } from "@/lib/firestore-compat";

// Force server-side execution (prevents build-time crypto errors)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Setup MFA - Generate QR code and recovery codes
 * Rate-limited to prevent abuse of TOTP secret generation.
 */
async function setupMFAHandler(request: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Retrieve user to check if MFA is already enabled (A-01)
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }
        const userData = userDoc.data();
        if (userData?.mfaEnabled) {
            return NextResponse.json(
                { success: false, error: "MFA is already enabled" },
                { status: 409 }
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

        const secretKey = process.env.MFA_SECRET_KEY;
        if (!secretKey) {
            logger.error("FATAL: MFA_SECRET_KEY is not set");
            return NextResponse.json(
                { success: false, error: "Service configuration error" },
                { status: 500 }
            );
        }
        const encryptedSecret = encryptData(secret, secretKey);

        // Store encrypted secret (Admin SDK)
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            totpSecret: encryptedSecret,
            mfaEnabled: false,
            updatedAt: FieldValue.serverTimestamp(),
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

export const POST = withRateLimit(setupMFAHandler);
