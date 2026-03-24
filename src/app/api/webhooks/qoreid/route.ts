import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "crypto";
import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";

// QoreID sends webhooks for async identity verification events
// and workflow completions.

export async function POST(req: NextRequest) {
    try {
        const payload = await req.text();
        const headersList = await headers();
        
        // QoreID signature is typically sent in x-qoreid-signature or x-hub-signature
        const qoreidSignature = headersList.get("x-qoreid-signature") || headersList.get("x-webhook-signature");
        const secret = process.env.QOREID_WEBHOOK_SECRET || process.env.QOREID_SECRET_KEY;

        if (!secret) {
            logger.error("Missing QOREID_WEBHOOK_SECRET in environment variables.");
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        // Verify HMAC signature if applicable
        if (qoreidSignature && secret) {
            const hmac = crypto.createHmac("sha256", secret);
            const generatedSignature = hmac.update(payload).digest("hex");
            
            // Allow matching if signature is correct
            if (generatedSignature !== qoreidSignature) {
                logger.warn("Invalid QoreID webhook signature mismatch.", { expected: generatedSignature, received: qoreidSignature });
                // Return 401 if security is strictly required by the client's risk posture.
                return NextResponse.json({ error: "Invalid Signature" }, { status: 401 });
            }
        }

        const data = JSON.parse(payload);
        const eventType = data.event || data.eventType || "unknown";
        
        logger.info(`Received QoreID webhook event: ${eventType}`, { data });

        const historyRef = db.collection("_qoreid_webhook_history").doc();
        await historyRef.set({
            eventId: data.id || historyRef.id,
            eventType,
            payload: data,
            processed: false,
            createdAt: new Date()
        });
        
        return NextResponse.json({ received: true });

    } catch (error) {
        logger.error("Error processing QoreID Webhook", { error });
        return NextResponse.json({ error: "Webhook Error" }, { status: 400 });
    }
}
