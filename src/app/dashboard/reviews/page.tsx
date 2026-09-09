/**
 * A member's own reviews — the server half. See #543 / #545.
 */

import { getUserReviewsAction } from "@/app/actions/reviews";
import type { ProductReview } from "@/lib/types/marketplace";
import MyReviewsClient from "./MyReviewsClient";

/**
 *   #547 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MyReviewsPage() {
    const result = await getUserReviewsAction().catch(() => null);
    const initial = result?.success && result.data?.reviews
        ? (result.data.reviews as ProductReview[])
        : null;

    return <MyReviewsClient initial={initial} />;
}
