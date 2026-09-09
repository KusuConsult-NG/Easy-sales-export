/**
 * The cooperative payment gate — the server half. See #543 / #545.
 *
 * This screen exists to decide where somebody should be: already a member ->
 * the dashboard, already paid -> onboarding, pending -> the dashboard,
 * otherwise -> pay. That decision was made in the browser, so everyone hit a
 * spinner first and the ones being redirected paid for a page they never saw.
 *
 * The read moves here; every branch it feeds stays in the client, including the
 * paymentStatus-before-membershipStatus ordering the file records, and the
 * dedicated-domain prefix, which is resolved from window.location and has no
 * meaning on the server.
 */

import { getMembershipAction } from "@/app/actions/cooperative";
import { rawSeed } from "@/lib/server-seed";
import CooperativePaymentClient from "./CooperativePaymentClient";

/**
 *   #560 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CooperativePaymentPage() {
    const initial = rawSeed(
        "cooperative membership", await getMembershipAction().catch(() => null),
    );

    return <CooperativePaymentClient initial={initial} />;
}
