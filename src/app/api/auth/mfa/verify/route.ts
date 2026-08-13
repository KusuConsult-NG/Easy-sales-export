import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

// Force server-side execution
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { withRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/auth/mfa/verify
 *
 * Verifies a TOTP code and issues the `mfa_verified` cookie.
 *
 * NOTHING READS THAT COOKIE, AND NOTHING ENFORCES MFA.
 *
 * The comment here used to say the cookie was consumed by middleware.
 * src/middleware.ts contains no MFA logic at all, and a search for the cookie
 * contains no MFA logic at all, and a search for the cookie name across src
 * returns this file and nothing else. The same is true of the rest of the
 * feature:
 *
 *   requiresMFA()        names ten sensitive actions — withdrawal,
 *                        fund_release, loan_approval, escrow_release,
 *                        role_change, admin_action among them — and has NO
 *                        CALLERS.
 *   verifyBackupCode()   exists and is never called, so the eight recovery
 *                        codes handed to the user at setup, over the words
 *                        "Each can only be used once", cannot be redeemed.
 *   verifyMFACode()      the email-code path, also uncalled.
 *
 * So a user who enables MFA scans a QR code, saves recovery codes, and their
 * account is protected exactly as much as it was before. The four routes in
 * this directory each work; nothing connects them to anything.
 *
 * That is a gap to close deliberately rather than quietly: switching enforcement
 * on for those ten actions while backup codes cannot be redeemed would lock
 * anyone who loses their authenticator out of withdrawals with no way back.
 * Recorded here and pinned by a test rather than half-wired.
 */
async function verifyMFAHandler(request: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { code } = await request.json();

        if (!code || typeof code !== "string") {
            return NextResponse.json(
                { success: false, error: "Verification code is required" },
                { status: 400 }
            );
        }

        // Get user's MFA secret from Firestore (Admin SDK)
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data()!;

        if (!userData.mfaEnabled || !userData.totpSecret) {
            return NextResponse.json(
                { success: false, error: "MFA not set up" },
                { status: 400 }
            );
        }

        const { verifyTOTPToken } = await import("@/lib/mfa");
        const { decryptData } = await import("@/lib/security");

        const secretKey = process.env.MFA_SECRET_KEY;
        if (!secretKey) {
            logger.error("FATAL: MFA_SECRET_KEY is not set");
            return NextResponse.json(
                { success: false, error: "Service configuration error" },
                { status: 500 }
            );
        }

        let secret: string;
        try {
            secret = decryptData(userData.totpSecret, secretKey);
        } catch (decryptErr) {
            logger.error("MFA secret decryption failed:", decryptErr);
            return NextResponse.json(
                { success: false, error: "Failed to verify MFA code" },
                { status: 500 }
            );
        }

        const isValid = verifyTOTPToken(code, secret);

        if (!isValid) {
            return NextResponse.json(
                { success: false, error: "Invalid verification code" },
                { status: 400 }
            );
        }

        // Set MFA verified cookie (30 minutes)
        const hostname = (
            request.headers.get("x-forwarded-host") ||
            request.headers.get("host") ||
            ""
        ).split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
        const hostParts = hostname.replace(/^www\./, "").split(".");
        const isLocal = hostname.includes("localhost") || hostname.includes("127.0.0.1");
        const domain = (!isLocal && hostParts.length >= 2) ? `.${hostParts.slice(-2).join(".")}` : undefined;

        // The value is bound to the user, not the literal "true".
        //
        // "true" says nothing about WHO verified, and this cookie is issued with
        // a wildcard domain and a thirty-minute life. On a shared browser, user
        // A verifying and signing out left a cookie user B would inherit —
        // sign-out clears cookies by name and this is not one of them. Signed
        // with MFA_SECRET_KEY, which every route in this feature already
        // requires, so a value from another account or another browser fails
        // rather than being accepted.
        //
        // This matters for whoever wires enforcement rather than for today: see
        // the header comment on this route. Fixing the primitive now means the
        // person who connects it does not inherit the bypass.
        const { issueMfaVerifiedValue } = await import("@/lib/mfa");

        const response = NextResponse.json({ success: true });
        response.cookies.set("mfa_verified", issueMfaVerifiedValue(session.user.id, secretKey), {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 30 * 60,
            domain,
            path: "/",
        });

        return response;
    } catch (error: any) {
        logger.error("MFA verification error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to verify MFA code" },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(verifyMFAHandler);
