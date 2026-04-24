import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

// You can optionally verify the Resend Webhook Signature here 
// using the Svix library if you configure RESEND_WEBHOOK_SECRET.
import { headers } from "next/headers";
import { Webhook } from "svix";

/**
 * Handle incoming Resend Webhook events.
 * Listens for:
 * - email.bounced
 * - email.complained
 * - email.delivery_delayed (optional, not currently excluding)
 */
export async function POST(req: NextRequest) {
    try {
        const payloadText = await req.text();
        const headersList = await headers();
        const resendSecret = process.env.RESEND_WEBHOOK_SECRET;
        
        let body;
        
        if (resendSecret) {
            const svix_id = headersList.get("svix-id");
            const svix_timestamp = headersList.get("svix-timestamp");
            const svix_signature = headersList.get("svix-signature");

            if (!svix_id || !svix_timestamp || !svix_signature) {
                 return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
            }

            const wh = new Webhook(resendSecret);
            try {
                body = wh.verify(payloadText, {
                    "svix-id": svix_id,
                    "svix-timestamp": svix_timestamp,
                    "svix-signature": svix_signature,
                });
            } catch (err) {
                logger.error("[Resend Webhook] Invalid signature", err);
                return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
            }
        } else {
            logger.warn("[Resend Webhook] RESEND_WEBHOOK_SECRET is not set — bypassing signature validation.");
            body = JSON.parse(payloadText);
        }

        // Basic validation of the Resend webhook payload
        if (!body || !(body as any).type || !(body as any).data) {
            return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
        }

        const { type, data } = body as any;
        const eventType = type as string;

        // We only care about terminal failures (bounces) and spam complaints
        if (eventType === "email.bounced" || eventType === "email.complained") {
            const emailToExclude = data.to?.[0]; // Usually an array, we take the first

            if (emailToExclude && typeof emailToExclude === "string") {
                const db = getAdminDb();
                
                // Use the email as the Document ID for easy lookups
                // Replacing invalid characters in document ID just in case (e.g. slashes)
                const docId = emailToExclude.toLowerCase().replace(/\//g, "_");

                await db.collection(COLLECTIONS.BOUNCED_EMAILS).doc(docId).set({
                    email: emailToExclude.toLowerCase(),
                    reason: eventType,
                    metadata: data, // Store the raw bounce data for debugging
                    recordedAt: new Date(),
                    source: "webhook"
                }, { merge: true }); // Merge in case it already exists

                logger.info(`[Resend Webhook] Excluded email ${emailToExclude} due to ${eventType}`);
            }
        }

        return NextResponse.json({ received: true });
    } catch (error: any) {
        logger.error("[Resend Webhook] Error:", error);
        // It's best practice to return a 200/202 to webhooks even if process fails 
        // to prevent infinite retry loops from the provider if the failure is unrecoverable,
        // unless you actively want Resend to retry.
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
