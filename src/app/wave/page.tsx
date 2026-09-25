import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
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
    const session = await auth();

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
