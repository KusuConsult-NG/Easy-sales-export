import { redirect } from "next/navigation";

/**
 * /marketplace/buyer — the buyer area's front door.
 *
 *   #934 IT WAS THE ONLY ONE OF FOUR THAT REDIRECTED IN THE BROWSER.
 *
 *   The platform has four of these forwarding pages, and the other three —
 *   dashboard/orders, marketplace/sell/orders and cooperatives/page — are one
 *   line of `redirect()` on the server. This one shipped a client component
 *   that mounted, painted a spinner, ran an effect and then called
 *   `router.replace`:
 *
 *       useEffect(() => { router.replace("/marketplace/buyer/products"); }, [router]);
 *
 *   What that costs, in order: the buyer waits for the page's JavaScript before
 *   anything moves, sees a spinner that means nothing, and lands on the products
 *   page one client navigation later. With JavaScript unavailable or still
 *   loading, the spinner is the whole screen and the redirect never happens —
 *   and a crawler following the link is served a page whose only content is a
 *   loading animation.
 *
 *   A server redirect is a 307 before any HTML is sent. Nothing about WHERE it
 *   goes changes.
 */
export default function BuyerRootPage() {
    redirect("/marketplace/buyer/products");
}
