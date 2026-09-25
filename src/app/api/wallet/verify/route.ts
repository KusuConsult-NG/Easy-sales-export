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
        /*
         *   THE EXCEPTION'S OWN MESSAGE USED TO GO INTO THE URL.
         *
         *   `encodeURIComponent(err.message)`, reflected into the redirect and
         *   rendered on the wallet page. The two messages above are the
         *   action's own, written to be read by a member; this one is whatever
         *   threw — a database error, a fetch failure, a Paystack client
         *   message — and this route takes its reference from the query string
         *   with no session, so anyone can reach it.
         *
         *   Encoding stops it being script; it does not stop it being a
         *   description of the inside of the server, handed to whoever asked.
         *   The detail goes to the log, where somebody can act on it, and the
         *   member gets the one sentence that is true for every case.
         */
        logger.error("[Wallet Verify API] Uncaught handler error:", err);
        const safe = encodeURIComponent("We could not confirm that payment. Please check your wallet.");
        return NextResponse.redirect(new URL(`/dashboard/wallet?status=failed&error=${safe}`, request.nextUrl.origin));
    }
}
