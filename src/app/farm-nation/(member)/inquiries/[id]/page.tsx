/**
 * Farm Nation inquiry detail — the server half. See #543 / #545.
 *
 * A refusal or a failure passes null and the client fetches as before, so
 * "Inquiry not found" and an access refusal keep saying themselves rather than
 * being flattened into a 404 here.
 */

import { getLandInquiryByIdAction } from "@/app/actions/land-listings";
import InquiryDetailsClient from "./InquiryDetailsClient";

/**
 *   #548 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function InquiryDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await getLandInquiryByIdAction(id).catch(() => null);
    const initial = result?.success && result.data ? result.data : null;

    return <InquiryDetailsClient initial={initial} />;
}
