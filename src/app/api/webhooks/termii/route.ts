import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getAdminDb } from "@/lib/firebase-admin";

export async function POST(req: Request) {
    try {
        const url = new URL(req.url);
        const providedSecret = url.searchParams.get("secret");
        const expectedSecret = process.env.TERMII_WEBHOOK_SECRET || process.env.TERMII_SECRET_KEY;

        // Secret validation (if configured in Termii Dashboard URL like ?secret=...)
        if (expectedSecret) {
             if (!providedSecret || providedSecret !== expectedSecret) {
                 logger.warn("[termii-webhook] Unauthorized webhook attempt. Missing or invalid secret.");
                 return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
             }
        }

        const body = await req.json();
        logger.info("[termii-webhook] Received Webhook Payload:", body);

        // Log Termii Delivery Reports (DLR) to Firestore to track message statuses
        if (body && body.message_id && body.status) {
            const db = getAdminDb();
            const status = String(body.status).toLowerCase();
            
            await db.collection("termii_delivery_logs").doc(String(body.message_id)).set({
                messageId: body.message_id,
                status: status,
                phone: body.to || "unknown",
                updatedAt: new Date().toISOString(),
                payload: body
            }, { merge: true });
            
            logger.info(`[termii-webhook] Logged DLR for message ${body.message_id} -> ${status}`);
        }

        // Acknowledge receipt (200 OK prevents Termii retries)
        return NextResponse.json({ success: true, message: "Webhook processed" }, { status: 200 });
    } catch (error) {
        logger.error("[termii-webhook] Failed to parse webhook:", error);
        return NextResponse.json({ success: false, error: "Bad request" }, { status: 400 });
    }
}
