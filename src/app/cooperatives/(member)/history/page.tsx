/**
 * Cooperative transaction history — the server half. See #543 / #545.
 */

import { getTransactionsAction } from "@/app/actions/cooperative";
import type { CooperativeTransaction } from "@/lib/types/cooperative";
import CooperativeHistoryClient from "./CooperativeHistoryClient";

/**
 *   #546 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it.
 *   Saying so stops the build-time probe and its misleading stack traces (#543).
 */
export const dynamic = "force-dynamic";

export default async function CooperativeHistoryPage() {
    const res = await getTransactionsAction().catch(() => null);
    const initial = res?.success && res.data?.transactions
        ? (res.data.transactions as CooperativeTransaction[])
        : null;

    return <CooperativeHistoryClient initial={initial} />;
}
