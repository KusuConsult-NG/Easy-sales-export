import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";
import { checkModuleAccess } from "@/lib/module-access-check";
import { waveDestinationFor } from "@/lib/wave-access";

/**
 * The WAVE front door.
 *
 *   #929 IT KNEW THREE OF THE FIVE STATUSES THE GATE ADMITS. `pending` and
 *   `under_review` went to the review-pending screen and EVERYTHING ELSE fell
 *   through to the marketing page — including `revision_required`, which the
 *   reviewer's "request changes" writes with a note the applicant has not been
 *   emailed. She arrived here to find out what was wanted and read "Begin Here
 *   - Apply Now!"
 *
 *   The destination is lib/wave-access's now, where the gate's own status list
 *   lives, so a status added to one cannot be missed by the other.
 */
export default async function WAVEPage() {
    /*
     *   #966 THIS CALLED auth() DIRECTLY, AND IT WAS THE LAST PLACE IN THE TREE
     *        THAT DECIDED ANYTHING FROM A RAW JWT SESSION.
     *
     *        Every sibling front door — wave/(member), academy/(learner),
     *        export/(app), cooperatives/(member), marketplace/buyer and /seller,
     *        farm-nation/(member) — reaches checkModuleAccess through
     *        requireSession or requireHubRegistration. This one did not, so the
     *        roles it handed the gate had had none of what requireSession does:
     *        no force-sync against the row, no ban check, no suspension check, no
     *        sessionsValidFrom revocation, and no fail-closed refusal of an
     *        elevated session it could not verify.
     *
     *        #965 measured that difference by execution. It is the one shape where
     *        #356's sentence — a role claim "keeps its value for hours after the
     *        database loses it" — is still literally true, and forty-four doors
     *        were converted under #951 on the strength of it while this one sat
     *        uncounted, because the ledger counted isAdmin spellings and this file
     *        asks checkModuleAccess.
     *
     *        AND IT UNDERMINED THIS FILE'S OWN PURPOSE. #929 exists because the
     *        destination must follow the member's WAVE registration status; the
     *        status was read off `session.user.serviceRegistrations`, which on a
     *        raw session is whatever the token carried when it was minted.
     *        requireSession force-syncs serviceRegistrations from the row beside
     *        the roles, so an applicant whose status changed to
     *        `revision_required` an hour ago is now sent where #929 says rather
     *        than by an hour-old copy of it.
     *
     *        No change to where a signed-out caller goes: requireSession returns a
     *        null session for them exactly as auth() returned null, and the
     *        marketing page is still the answer.
     */
    const sessionResult = await requireSession();
    const session = sessionResult.session;

    if (session?.user?.id) {
        const roles = session.user.roles || [];

        /*
         *   THE DATABASE GATE DECIDES THE DASHBOARD, still.
         *
         *   checkModuleAccess reads the registration rather than the token, so
         *   it admits a member whose JWT has not caught up with her approval.
         *   The shared rule below cannot do that — it is pure, because the
         *   middleware that shares it runs on the edge — so it is asked only
         *   where the session's own answer is the best there is.
         */
        const hasAccess = await checkModuleAccess(session.user.id, roles as any, "wave");
        if (hasAccess) {
            redirect("/wave/dashboard");
        }

        const serviceRegistrations = (session.user as any).serviceRegistrations || {};
        redirect(waveDestinationFor({
            roles: roles as string[],
            waveRegStatus: serviceRegistrations.wave?.status ?? null,
        }));
    }

    redirect("/wave/landing");
}
