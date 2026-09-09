/**
 * Academy setup — the server half. See #543 / #545.
 *
 * Three reads made in the browser after the page had already arrived, two of
 * which are INDEPENDENT and were nonetheless awaited one after the other: the
 * learner's profile (for the structured name, phone and state that pre-fill the
 * form) and their application status. They run together here.
 *
 * The third — the payment check — is genuinely conditional on the status, so it
 * stays conditional, and a learner whose application is not awaiting review
 * costs the same two reads they always did.
 *
 * Every decision those answers feed stays in the client: the redirect to the
 * dashboard, the redirect to the pending page, and #316's rule that a payment
 * check which FAILED must not push a learner who may have paid back toward
 * paying again.
 */

import {
    checkAcademyPaymentStatusAction,
    checkAcademyStatusAction,
} from "@/app/actions/academy";
import { getUserProfileAction } from "@/app/actions/profile";
import { rawSeed } from "@/lib/server-seed";
import AcademySetupClient from "./AcademySetupClient";

/**
 *   #558 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function AcademySetupPage() {
    const [profileResult, statusResult] = await Promise.all([
        getUserProfileAction().catch(() => null),
        checkAcademyStatusAction().catch(() => null),
    ]);

    const profile = rawSeed("academy setup profile", profileResult);
    const status = rawSeed("academy application status", statusResult);

    //   The same condition the client reads it under.
    const awaitingReview = status?.data === "pending" || status?.data === "under_review";

    const payment = awaitingReview
        ? rawSeed(
            "academy payment status",
            await checkAcademyPaymentStatusAction().catch(() => null),
        )
        : null;

    //   All or nothing: a half-walked chain is a seed present while the rest
    //   still fetches, the failure the ledger warns about.
    const complete = profile !== null
        && status !== null
        && (!awaitingReview || payment !== null);

    return (
        <AcademySetupClient
            initial={complete && profile && status ? { profile, status, payment } : null}
        />
    );
}
