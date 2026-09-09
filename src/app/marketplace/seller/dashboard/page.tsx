/**
 * Marketplace seller dashboard — the server half. See #543.
 *
 * Four actions, run here in parallel exactly as the client's effect ran them,
 * with the raw results handed over. The order sorting and the top-products
 * selection stay in the client where they already live.
 */

import { getSellerAnalyticsAction, getSellerOrdersAction, getSellerProductsAction } from "@/app/actions/marketplace";
import { getFeatureTogglesAction } from "@/app/actions/health";
import SellerDashboardClient from "./SellerDashboardClient";

export default async function SellerDashboardPage() {
    const [analyticsRes, ordersRes, productsRes, togglesRes] = await Promise.all([
        getSellerAnalyticsAction().catch(() => null),
        getSellerOrdersAction().catch(() => null),
        getSellerProductsAction().catch(() => null),
        getFeatureTogglesAction().catch(() => null),
    ]);

    //   All four or none — a partial seed leaves the missing panels empty for
    //   good, because the client skips its whole load when seeded.
    //
    //   Written as four explicit checks rather than `settled.every(Boolean)`,
    //   which reads the same and does NOT narrow the tuple: tsc rejected the
    //   nulls that version was still handing over.
    const initial = analyticsRes && ordersRes && productsRes && togglesRes
        ? { analyticsRes, ordersRes, productsRes, togglesRes }
        : null;

    return <SellerDashboardClient initial={initial} />;
}
