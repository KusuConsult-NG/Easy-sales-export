/**
 * Cooperative member dashboard — the server half. See #543.
 *
 * The client's own comment says getDashboardDataAction "has its own
 * multi-fallback queries", which is exactly why it is called here unchanged
 * rather than reimplemented: one definition of how a membership is found.
 */

import { getDashboardDataAction } from "@/app/actions/cooperative";
import CooperativeDashboardClient from "./CooperativeDashboardClient";

export default async function CooperativeDashboardPage() {
    const result = await getDashboardDataAction().catch(() => null);
    const initial = result?.success && result.data
        ? { membership: result.data.membership, transactions: result.data.transactions }
        : null;

    return <CooperativeDashboardClient initial={initial} />;
}
