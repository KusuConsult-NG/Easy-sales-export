import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

// You can optionally verify the Resend Webhook Signature here 
// using the Svix library if you configure RESEND_WEBHOOK_SECRET.
// For now, we process the payload directly if it matches the expected structure.

/**
 * Handle incoming Resend Webhook events.
 * Listens for:
 * - email.bounced
 * - email.complained
 * - email.delivery_delayed (optional, not currently excluding)
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // Basic validation of the Resend webhook payload
        if (!body || !body.type || !body.data) {
            return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
        }

        const { type, data } = body;
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

                console.log(`[Resend Webhook] Excluded email ${emailToExclude} due to ${eventType}`);
            }
        }

        return NextResponse.json({ received: true });
    } catch (error: any) {
        console.error("[Resend Webhook Error]:", error);
        // It's best practice to return a 200/202 to webhooks even if process fails 
        // to prevent infinite retry loops from the provider if the failure is unrecoverable,
        // unless you actively want Resend to retry.
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
