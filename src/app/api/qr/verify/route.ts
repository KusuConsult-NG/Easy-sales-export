// Use Node.js runtime for crypto operations
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import { verifyDigitalIDQR } from "@/lib/digital-id";
import { createAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";

/**
 * POST /api/qr/verify
 * Verify Digital ID QR Code
 * Admin only
 */
export async function POST(request: NextRequest) {
    try {
        // Check authentication
        const session = await auth();
        if (!session || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return NextResponse.json(
                { error: "Unauthorized - Admin access required" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { qrData } = body;

        if (!qrData) {
            return NextResponse.json(
                { error: "QR data is required" },
                { status: 400 }
            );
        }

        // Verify QR code
        const result = verifyDigitalIDQR(qrData);

        // Log verification attempt
        await createAuditLog({
            action: result.valid ? "user_verify" : "suspicious_activity",
            userId: session.user.id,
            targetId: result.payload?.userId,
            targetType: "digital_id_verification",
            metadata: {
                success: result.valid,
                error: result.error,
                verifiedMemberNumber: result.payload?.memberNumber,
            },
        });

        if (!result.valid) {
            return NextResponse.json(
                {
                    valid: false,
                    error: result.error,
                },
                { status: 200 }
            );
        }

        return NextResponse.json({
            valid: true,
            data: result.payload,
        });
    } catch (error) {
        console.error("QR verification error:", error);
        return NextResponse.json(
            { error: "Verification failed" },
            { status: 500 }
        );
    }
}
