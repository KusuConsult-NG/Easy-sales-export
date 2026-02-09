import { NextRequest, NextResponse } from "next/server";
import { verifyEnrollmentPaymentAction } from "@/app/actions/academy-payment";

/**
 * Academy Payment Verification Route
 * Handles Paystack payment callbacks
 */
export async function GET(request: NextRequest) {
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
        console.error("Payment verification error:", error);
        return NextResponse.redirect(
            new URL("/academy?error=verification_failed", request.url)
        );
    }
}
