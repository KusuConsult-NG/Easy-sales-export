import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
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

        // Lazy-load crypto-dependent functions to prevent build-time execution
        const {
            generateTOTPSecret,
            generateTOTPQRCode,
            generateBackupCodes,
            storeBackupCodes
        } = await import("@/lib/mfa");
        const { encryptData } = await import("@/lib/security");

        // Generate TOTP secret
        const secret = generateTOTPSecret();

        // Generate QR code
        const qrCode = await generateTOTPQRCode(session.user.email!, secret);

        // Generate recovery codes
        const recoveryCodes = generateBackupCodes(8);

        // Encrypt secret before storing
        const secretKey = process.env.MFA_SECRET_KEY || 'default-secret-key-change-in-production';
        const encryptedSecret = encryptData(secret, secretKey);

        // Store encrypted secret temporarily (will be confirmed on verification)
        await updateDoc(doc(db, COLLECTIONS.USERS, session.user.id), {
            totpSecret: encryptedSecret,
            mfaEnabled: false, // Not enabled until verified
            updatedAt: new Date(),
        });

        // Store recovery codes
        await storeBackupCodes(session.user.id, recoveryCodes);

        return NextResponse.json({
            success: true,
            qrCode,
            secret, // Send unencrypted for QR display
            recoveryCodes,
        });
    } catch (error: any) {
        console.error("MFA setup error:", error);
        return NextResponse.json(
            { success: false, error: "Setup failed" },
            { status: 500 }
        );
    }
}
