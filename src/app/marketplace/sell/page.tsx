/**
 * Marketplace seller home — the server half. See #543 / #545.
 *
 * The catalogue and the verification record were already parallel in the client
 * and are fetched here instead. The RAW results are handed over: #492 recorded
 * what a failed read costs on this screen — a seller with a full catalogue
 * shown an empty shop — so the client keeps its own success handling.
 */

import { getSellerProductsAction, getSellerVerificationAction } from "@/app/actions/marketplace";
import { rawSeed } from "@/lib/server-seed";
import SellerHomeClient from "./SellerHomeClient";

/**
 *   #555 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function SellerDashboardPage() {
    const [productsRes, verificationRes] = await Promise.all([
        getSellerProductsAction().catch(() => null),
        getSellerVerificationAction().catch(() => null),
    ]);

    const initial = productsRes && verificationRes
        ? {
            productsRes: rawSeed("seller products", productsRes),
            verificationRes: rawSeed("seller verification", verificationRes),
        }
        : null;

    return <SellerHomeClient initial={initial} />;
}
