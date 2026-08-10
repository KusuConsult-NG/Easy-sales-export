import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getAdminDb } from "@/lib/supabase-db";

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

        if (!providedSecret || providedSecret !== expectedSecret) {
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
