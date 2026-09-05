/**
 *   #384 RETIRED — THE COOPERATIVE ONBOARDING DOES NOT END HERE EITHER.
 *
 *        OnboardingClient finishes with `router.replace(`${prefix}/dashboard`)` at
 *        both of its completion points. This screen was never in that path.
 *
 *   NOTHING IS DELETED. The implementation is in this file's git history, and
 *   the URL keeps working: anyone holding a link or a bookmark lands on the
 *   screen that does the job. #362 recorded eleven screens like this as an owner
 *   decision; the standing instruction is that none of them is, so each was
 *   measured and either wired or pointed at its live equivalent.
 */

import { redirect } from "next/navigation";

export default function RetiredPage() {
    redirect("/cooperatives/dashboard");
}
