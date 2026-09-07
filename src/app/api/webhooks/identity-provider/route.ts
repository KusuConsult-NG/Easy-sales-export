import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/**
 *   #485 A WEBHOOK RECEIVER FOR A SERVICE THAT IS NOT IN USE.
 *
 *   This accepted async identity-verification callbacks from the external
 *   provider the owner has taken out of service, verified an HMAC against
 *   its signing secret, and staged every event into a webhook-history collection
 *   with `processed: false`.
 *
 *   TWO REASONS IT DOES NOT STAY WIRED.
 *
 *   The provider is parked, so no legitimate event can arrive — the endpoint's
 *   entire remaining population is whatever finds the URL. And the signing
 *   secret it checked against is unset in production, which made the receiver
 *   answer 500 to everything: the guard was correct and could never run.
 *
 *   Meanwhile nothing has ever READ that collection. Rows were staged
 *   `processed: false` for a consumer nobody wrote. So the endpoint's real
 *   behaviour was to accumulate unread rows from unauthenticated callers, which
 *   is a write path into the database with no purpose behind it.
 *
 *   IT REFUSES, AND SAYS WHY. 410 Gone rather than 404: a caller that was
 *   configured to post here gets an answer that distinguishes "this endpoint has
 *   been retired" from "you have the wrong URL", which is the difference between
 *   a five-minute diagnosis and an afternoon.
 *
 *   NOTHING IS DELETED. The rows already staged are untouched — the owner's
 *   standing rule — and the parked provider module keeps the integration for the day
 *   this is turned back on. Restoring it means restoring this file from history
 *   and setting the secret; the HMAC comparison it used was repaired twice (a
 *   missing-signature bypass, and a logged expected-signature that was a
 *   replayable forgery) and both repairs are in the history with it.
 */
export async function POST() {
    logger.warn("[Webhook] Identity-provider callback received while the provider is not in service");
    return NextResponse.json(
        {
            error: "This endpoint has been retired. No external identity provider is in service.",
            received: false,
        },
        { status: 410 }
    );
}
