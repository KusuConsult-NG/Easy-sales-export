/**
 * Farm Nation inquiries — the server half. See #543 / #545.
 */

import { auth } from "@/lib/auth";
import { getLandInquiriesAction } from "@/app/actions/land-listings";
import InquiriesClient from "./InquiriesClient";

/**
 *   #549 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function InquiriesPage() {
    //   The action takes the owner's id, which the client read off its session.
    //   Read here instead; a signed-out visitor passes null and the client's own
    //   effect does the redirect it always did.
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    const result = userId
        ? await getLandInquiriesAction(userId).catch(() => null)
        : null;
    const initial = result?.success && result.data ? (result.data as any[]) : null;

    return <InquiriesClient initial={initial} />;
}
