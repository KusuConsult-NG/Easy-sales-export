import { NextRequest, NextResponse } from "next/server";
import { confirmWalletFundingAction } from "@/app/actions/wallet";
import { logger } from "@/lib/logger";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        // Paystack passes the reference in either `reference` or `ref` parameter
        const reference = searchParams.get("reference") || searchParams.get("ref");

        if (!reference) {
            logger.error("[Wallet Verify API] Missing reference in query parameters");
            return NextResponse.redirect(new URL("/dashboard/wallet?status=failed&error=Missing+reference", request.nextUrl.origin));
        }

        logger.info(`[Wallet Verify API] Verifying wallet funding for reference: ${reference}`);
        const result = await confirmWalletFundingAction(reference);

        if (result.success) {
            logger.info(`[Wallet Verify API] Wallet funding successful for reference: ${reference}`);
            return NextResponse.redirect(new URL("/dashboard/wallet?status=success", request.nextUrl.origin));
        } else {
            logger.error(`[Wallet Verify API] Verification failed for reference ${reference}: ${result.error}`);
            const errorMsg = encodeURIComponent(result.error || "Verification failed");
            return NextResponse.redirect(new URL(`/dashboard/wallet?status=failed&error=${errorMsg}`, request.nextUrl.origin));
        }
    } catch (err: any) {
        logger.error("[Wallet Verify API] Uncaught handler error:", err);
        return NextResponse.redirect(new URL(`/dashboard/wallet?status=failed&error=${encodeURIComponent(err.message || "Internal error")}`, request.nextUrl.origin));
    }
}
