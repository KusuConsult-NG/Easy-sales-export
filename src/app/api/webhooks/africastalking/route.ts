import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getAdminDb } from "@/lib/supabase-db";
import { secretsMatch } from "@/lib/secret-compare";

//   #659 — this was a local `secretsMatch` that returned false as soon as the
//   LENGTHS differed, while api/auth/health's copy of the same function padded
//   and compared anyway. One contract, two statements of it, disagreeing about
//   the thing the function exists to control. Both import lib/secret-compare
//   now, which does not short-circuit.

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const url = new URL(req.url);
        const providedSecret = url.searchParams.get("secret");
        const expectedSecret = process.env.AT_WEBHOOK_SECRET;

        // Fail CLOSED when the secret is not configured.
        //
        // This was `if (expectedSecret) { ...check... }`, so a deployment that
        // forgot AT_WEBHOOK_SECRET accepted every unauthenticated POST silently.
        // An unset secret is a misconfiguration, not permission to skip the
        // check, and the endpoint should refuse rather than quietly open.
        if (!expectedSecret) {
            logger.error("[africastalking-webhook] AT_WEBHOOK_SECRET is not set — refusing to process.");
            return NextResponse.json({ success: false, error: "Configuration Error" }, { status: 500 });
        }

        /**
         *   #645 COMPARED WITH `!==`, WHERE ITS SIBLING USES timingSafeEqual.
         *
         *   `verifyPaystackWebhook` in lib/paystack-server does the equivalent
         *   check with `crypto.timingSafeEqual` under a comment reading "Prevent
         *   timing attacks". This one, guarding the other end of the same kind
         *   of door, used a plain string comparison — which returns as soon as
         *   two bytes differ.
         *
         *   Over a network this is a poor oracle and the practical risk is low.
         *   It is corrected anyway, because the idiom already exists in this
         *   codebase, the fix costs nothing, and "the strict version went to one
         *   of the two doors" is the defect this audit has found more than any
         *   other.
         *
         *   RECORDED AND NOT FIXED: the secret arrives in the QUERY STRING, so
         *   it lands in access logs, proxy logs and any Referer that leaks. The
         *   transport is Africa's Talking's configuration, not this
         *   repository's, so moving it to a header is the owner's call with the
         *   provider.
         */
        if (!providedSecret || !secretsMatch(providedSecret, expectedSecret)) {
            logger.warn("[africastalking-webhook] Unauthorized webhook attempt. Missing or invalid secret.");
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const contentType = req.headers.get("content-type") || "";
        let payload: Record<string, string> = {};

        if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
            const formData = await req.formData();
            formData.forEach((value, key) => {
                payload[key] = String(value);
            });
        } else {
            try {
                payload = await req.json();
            } catch (jsonErr) {
                logger.warn("[africastalking-webhook] Failed to parse payload as JSON:", { error: String(jsonErr) });
            }
        }

        logger.info("[africastalking-webhook] Received Webhook Payload:", payload);

        const id = payload.id;
        const status = payload.status;
        const phoneNumber = payload.phoneNumber;

        if (id && status) {
            const db = getAdminDb();
            const lowerStatus = String(status).toLowerCase();

            await db.collection("africastalking_delivery_logs").doc(String(id)).set({
                messageId: id,
                status: lowerStatus,
                phone: phoneNumber || "unknown",
                updatedAt: new Date().toISOString(),
                payload: payload
            }, { merge: true });

            logger.info(`[africastalking-webhook] Logged DLR for message ${id} -> ${lowerStatus}`);
        }

        // Acknowledge receipt (200 OK prevents Africa's Talking retries)
        return NextResponse.json({ success: true, message: "Webhook processed" }, { status: 200 });
    } catch (error) {
        logger.error("[africastalking-webhook] Failed to parse webhook:", { error: String(error) });
        return NextResponse.json({ success: false, error: "Bad request" }, { status: 400 });
    }
}
