import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { verifyEnrollmentPaymentAction } from "@/app/actions/academy-payment";
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

// Rate limiter for payment verification callbacks
const paymentCallbackLimiter = rateLimit(rateLimitConfig.payment);

/**
 * Academy Payment Verification Route
 * Handles Paystack payment callbacks
 */
export async function GET(request: NextRequest) {
    // RATE LIMITING - Prevent payment callback abuse
    const clientIp = getClientIp(request);
    const rateLimitResult = await paymentCallbackLimiter.check(clientIp);

    if (!rateLimitResult.success) {
        return NextResponse.redirect(
            new URL("/academy?error=too_many_requests", request.url)
        );
    }

    const searchParams = request.nextUrl.searchParams;
    const reference = searchParams.get("reference");

    if (!reference) {
        return NextResponse.redirect(
            new URL("/academy?error=missing_reference", request.url)
        );
    }

    try {
        const result = await verifyEnrollmentPaymentAction(reference);

        if (result.success) {
            return NextResponse.redirect(
                new URL("/academy?success=enrollment_complete", request.url)
            );
        } else {
            return NextResponse.redirect(
                new URL(`/academy?error=${encodeURIComponent(result.error || "verification_failed")}`, request.url)
            );
        }
    } catch (error) {
        logger.error("Payment verification error:", error);
        return NextResponse.redirect(
            new URL("/academy?error=verification_failed", request.url)
        );
    }
}
