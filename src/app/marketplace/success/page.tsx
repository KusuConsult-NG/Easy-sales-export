/**
 * /marketplace/success — RETIRED. The verifying screen is /marketplace/payment/callback.
 *
 *   #908 A SCREEN THAT SAID "PAYMENT CONFIRMED" ON THE STRENGTH OF A QUERY
 *   STRING.
 *
 *   Found auditing the files no test had named. This page read `?reference` and
 *   rendered, unconditionally:
 *
 *       ✓  Payment Successful!
 *          Your order has been placed and payment confirmed
 *          Transaction Reference    <whatever the URL said>
 *
 *   It called nothing. It verified nothing. Opening
 *   /marketplace/success?reference=anything told the visitor their payment was
 *   confirmed and printed their own string back as the platform's transaction
 *   reference.
 *
 * ── MEASURED, BECAUSE THE SEVERITY DEPENDS ON IT ────────────────────────────
 *
 *   NOTHING ON THE PLATFORM LINKS HERE. Every Paystack callback URL in the
 *   codebase is `{baseUrl}/{module}/payment/callback` — marketplace, export,
 *   cooperatives, academy, farm-nation — and the marketplace's own
 *   `_payment_orders.ts` names `/marketplace/payment/callback`. This route
 *   appears in route-manifest and nowhere else. So no buyer is sent here by a
 *   payment, and the defect is not "buyers are told a failed payment
 *   succeeded".
 *
 *   WHAT IT IS INSTEAD: a page on this platform's own domain, with this
 *   platform's own branding, that will tell anybody their payment is confirmed
 *   and display any reference they choose. That is a ready-made proof-of-payment
 *   screenshot to send a seller, and it is the same class #262 worked on — a
 *   fabricated reference that reads as a real one.
 *
 *   AND A SWEEP SAYS IT WAS THE ONLY ONE. Every other screen that claims a
 *   payment succeeded either verifies (the five module callbacks) or renders a
 *   stored `payment_received` / `payment_confirmed` status off an order row,
 *   which is a fact rather than a claim. This was the single screen deriving
 *   that sentence from the URL.
 *
 * ── WHY A REDIRECT AND NOT A DELETION ───────────────────────────────────────
 *
 *   The same answer /land/submit got in #901: the URL keeps working and sends
 *   the person to the screen that does the job. /marketplace/payment/callback
 *   calls verifyOrderPaymentAction, shows "Verifying Payment…" while it waits,
 *   and shows the refusal when the reference is not a paid one — so a
 *   bookmarked link, a shared link, or a link somebody invented now lands
 *   somewhere that checks before it congratulates.
 *
 *   THE REFERENCE IS CARRIED, not dropped: a buyer who genuinely has one gets it
 *   verified rather than being asked to find it again. The callback's own
 *   "No payment reference found" handles the case where there is none.
 */

import { redirect } from "next/navigation";

/*
 *   NOT EXPORTED — see app/land/submit/page.tsx for the measurement. A page
 *   module may export only the names Next allows; anything else is constrained
 *   to `never` in the generated `.next/types` and fails the production build.
 *   This one had the same mistake and had not reached CI yet.
 */
/** The screen that verifies before it congratulates. */
const MARKETPLACE_PAYMENT_CALLBACK = "/marketplace/payment/callback";

export default async function MarketplaceSuccessPage({
    searchParams,
}: {
    searchParams: Promise<{ reference?: string }>;
}) {
    const { reference } = await searchParams;

    redirect(
        reference
            ? `${MARKETPLACE_PAYMENT_CALLBACK}?reference=${encodeURIComponent(reference)}`
            : MARKETPLACE_PAYMENT_CALLBACK,
    );
}
