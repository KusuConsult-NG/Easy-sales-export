/**
 *   #384 RETIRED — THE SECOND REVIEW FORM.
 *
 *        Two screens write PRODUCT_REVIEWS: this one through createReviewAction,
 *        and /marketplace/buyer/orders/[id]/review through
 *        submitProductReviewAction. Both actions are now equally hardened — an
 *        earlier pass gave them a shared reviewable-status rule, a duplicate
 *        guard that checks BOTH identity spellings, and the same image bounds —
 *        so this is no longer a guard asymmetry, just a duplicate screen.
 *
 *        The order page is the one that is linked, and it is the right one: a
 *        review belongs to an order line, and that screen already walks the
 *        buyer to the next unreviewed item (#122).
 *
 *   NOTHING IS DELETED. The implementation is in this file's git history, and
 *   the URL keeps working: anyone holding a link or a bookmark lands on the
 *   screen that does the job. #362 recorded eleven screens like this as an owner
 *   decision; the standing instruction is that none of them is, so each was
 *   measured and either wired or pointed at its live equivalent.
 */

import { redirect } from "next/navigation";

export default async function RetiredNewReviewPage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
    // Carries the order through, so a bookmarked link still lands on the
    // review form for the order it named.
    const { orderId } = await searchParams;
    redirect(orderId ? `/marketplace/buyer/orders/${orderId}/review` : "/marketplace/buyer/orders");
}
