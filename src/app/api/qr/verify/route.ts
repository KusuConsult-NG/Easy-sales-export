export const dynamic = 'force-dynamic';

// Use Node.js runtime for crypto operations
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { verifyDigitalIDQR } from "@/lib/digital-id";
import { createAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";

import { withRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/qr/verify
 * Verify Digital ID QR Code
 * Admin only
 */
async function verifyHandler(request: NextRequest) {
    try {
        // Check authentication
        const session = (await requireSession()).session;
        // #364. Was `roles.includes("admin") || roles.includes("super_admin")`,
        // which locked the academy_admin out of the academy's own certificates.
        // The permission is the one ACADEMY_MANAGE already maps certificates to.
        if (!session || !hasAdminPermission(session.user.roles, "academy:issue_certificates")) {
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
        logger.error("QR verification error:", error);
        return NextResponse.json(
            { error: "Verification failed" },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(verifyHandler);
