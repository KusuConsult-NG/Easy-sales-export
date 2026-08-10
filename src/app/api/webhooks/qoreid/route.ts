import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "crypto";
import { supabaseDb as db } from "@/lib/supabase-db";
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

        // A MISSING signature is a rejection, not a skip.
        //
        // This read `if (qoreidSignature && secret)`, so verification only
        // happened when the CALLER chose to supply a signature. Omitting the
        // header skipped the check entirely and fell through to processing the
        // payload — the guard was conditional on the attacker's own input,
        // which is the same as having no guard.
        //
        // Nothing consumes _qoreid_webhook_history today, so the reachable
        // impact was unauthenticated writes to an unused collection. That is
        // not why it matters: the rows are staged `processed: false` for a
        // consumer somebody will eventually write, and they would reasonably
        // assume anything in there arrived from QoreID.
        if (!qoreidSignature) {
            logger.warn("[QoreID Webhook] Rejected: no signature header supplied.");
            return NextResponse.json({ error: "Missing Signature" }, { status: 401 });
        }

        const hmac = crypto.createHmac("sha256", secret);
        const generatedSignature = hmac.update(payload).digest("hex");

        // Buffer.from(..., "hex") silently truncates on non-hex input, so a
        // malformed header could otherwise produce a short buffer that happens
        // to compare equal. Validate the shape before comparing.
        const expectedBuffer = Buffer.from(generatedSignature, "hex");
        const receivedBuffer = Buffer.from(qoreidSignature, "hex");

        if (
            receivedBuffer.length !== expectedBuffer.length ||
            !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
        ) {
            // The expected signature is NOT logged. It used to be, and it is the
            // correct HMAC for an attacker-supplied payload — anyone who can read
            // the logs could replay it as a valid forgery.
            logger.warn("[QoreID Webhook] Rejected: signature mismatch.");
            return NextResponse.json({ error: "Invalid Signature" }, { status: 401 });
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
