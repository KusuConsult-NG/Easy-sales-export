/**
 * The WAVE application — the server half. See #543 / #545.
 *
 * The same conditional shape as /export/onboarding in #558: a status check, and
 * then — depending on the answer — the saved application when editing or
 * revising, or the access check when already approved. Both round trips
 * happened after the page had been sent, downloaded and hydrated, so an
 * applicant coming back to a form they had been asked to revise sat on a
 * spinner before seeing a word of it.
 *
 * The same branch is followed here, so a first-time applicant — the common case
 * on this screen — still costs exactly one read, as she always did.
 *
 * Everything the answers feed stays in the client: the redirect to the
 * dashboard, the revision note, the deliberate decision NOT to auto-redirect a
 * pending applicant away from her own status.
 */

import {
    checkWaveAccessAction,
    checkWaveStatusAction,
    getWaveApplicationAction,
} from "@/app/actions/wave";
import { rawSeed } from "@/lib/server-seed";
import WaveApplicationClient from "./WaveApplicationClient";

/**
 *   #560 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

const AWAITING_REVIEW = ["pending", "under_review"];

export default async function WaveApplicationPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const status = rawSeed("wave status", await checkWaveStatusAction().catch(() => null));

    const waveStatus = status?.success ? status.data?.status : null;
    const isEdit = (await searchParams).edit === "true";

    //   The follow-up read, chosen by the same branch the client takes.
    const wantsApplication = (AWAITING_REVIEW.includes(waveStatus ?? "") && isEdit)
        || waveStatus === "revision_required";
    const wantsAccess = waveStatus === "approved";

    const application = wantsApplication
        ? rawSeed("wave application", await getWaveApplicationAction().catch(() => null))
        : null;

    const access = wantsAccess
        ? rawSeed("wave access", await checkWaveAccessAction().catch(() => null))
        : null;

    //   All or nothing: a half-walked chain is a seed present while the rest
    //   still fetches, the failure this ledger warns about.
    const complete = status !== null
        && (!wantsApplication || application !== null)
        && (!wantsAccess || access !== null);

    return (
        <WaveApplicationClient
            initial={complete && status ? { status, application, access } : null}
        />
    );
}
