/**
 * Export Windows onboarding — the server half. See #543 / #545.
 *
 * The screen's first act was a status check and then, depending on the answer,
 * a SECOND read: the saved application when editing or revising, or the access
 * check when already approved. Both round trips happened after the page had
 * been sent, downloaded and hydrated — which is why an applicant coming back to
 * their own half-finished form sat on a spinner.
 *
 * The same branch is followed here, so nothing is read speculatively: an
 * applicant who is neither editing nor approved still costs exactly one read.
 *
 * ── WHY THIS PAGE READS searchParams ────────────────────────────────────────
 *
 *   The edit branch is gated on `?edit=true`, which the client reads from
 *   window.location. The server has the same parameter, so it can take the same
 *   branch. If the two ever disagreed the client would simply fetch — the seed
 *   is consumed inside the branch it belongs to, not before it.
 *
 * Every redirect stays in the client, where it was.
 */

import {
    checkExportAccessAction,
    checkExportStatusAction,
    getExportApplicationAction,
} from "@/app/actions/export";
import { rawSeed } from "@/lib/server-seed";
import ExportOnboardingClient from "./ExportOnboardingClient";

/**
 *   #558 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

const PENDING = ["pending_approval", "pending", "under_review"];
const NEEDS_APPLICATION = ["revision_required", "rejected"];

export default async function ExportOnboardingPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    //   checkExportStatusAction returns a bare string or null and throws on
    //   failure, so there is no result envelope to unwrap here. A throw seeds
    //   nothing at all and the client asks for itself.
    const status = await checkExportStatusAction().catch(() => undefined);
    if (status === undefined) {
        return <ExportOnboardingClient initial={null} />;
    }

    const isEdit = (await searchParams).edit === "true";

    //   The follow-up read, chosen by the same branch the client takes.
    const wantsApplication = (PENDING.includes(status ?? "") && isEdit)
        || NEEDS_APPLICATION.includes(status ?? "");
    const wantsAccess = status === "approved" || status === "active";

    const application = wantsApplication
        ? rawSeed("export application", await getExportApplicationAction().catch(() => null))
        : null;

    const hasAccess = wantsAccess
        ? await checkExportAccessAction().catch(() => null)
        : null;

    //   All or nothing: a half-walked chain is a seed present while the rest
    //   still fetches.
    const complete = (!wantsApplication || application !== null)
        && (!wantsAccess || hasAccess !== null);

    return (
        <ExportOnboardingClient
            initial={complete ? { status: status ?? null, application, hasAccess } : null}
        />
    );
}
