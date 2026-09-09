/**
 * Marketplace product detail — the server half. See #543 / #545.
 *
 * The product and its related products are independent reads — both keyed on
 * the same id — and the client awaited them one after the other. They run in
 * parallel here.
 */

import { getProductAction, getRelatedProductsAction } from "@/app/actions/marketplace";
import ProductDetailClient from "./ProductDetailClient";
import { rawSeed } from "@/lib/server-seed";

/**
 *   #554 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const [productRes, relatedRes] = await Promise.all([
        getProductAction(id).catch(() => null),
        getRelatedProductsAction(id, 4).catch(() => null),
    ]);

    //   Both or neither: the client consumes the seed in one go.
    const initial = productRes && relatedRes
        ? {
            productRes: rawSeed("marketplace product", productRes),
            relatedRes: rawSeed("related products", relatedRes),
        }
        : null;

    return <ProductDetailClient initial={initial} />;
}
