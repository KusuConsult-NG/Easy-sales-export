/**
 * Saved sellers — the server half. See #543 / #545.
 */

import { getSavedSellersAction, type SavedSellerRecord } from "@/app/actions/saved-items";
import SavedSellersClient from "./SavedSellersClient";
import { seedOrNull } from "@/lib/server-seed";

/**
 *   #551 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function SavedSellersPage() {
    const data = seedOrNull("saved sellers", await getSavedSellersAction().catch(() => null));
    const initial = (data?.sellers as SavedSellerRecord[] | undefined) ?? null;

    return <SavedSellersClient initial={initial} />;
}
