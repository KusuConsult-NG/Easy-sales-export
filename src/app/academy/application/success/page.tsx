/**
 *   #384 RETIRED — THE ACADEMY APPLICATION DOES NOT END HERE.
 *
 *        The application wizard finishes with `router.push("/academy/dashboard")`
 *        (academy/application/page.tsx). Nothing has ever sent an applicant to
 *        this screen, and 80 lines of congratulation that no flow reaches is a
 *        screen describing something that did not happen.
 *
 *   NOTHING IS DELETED. The implementation is in this file's git history, and
 *   the URL keeps working: anyone holding a link or a bookmark lands on the
 *   screen that does the job. #362 recorded eleven screens like this as an owner
 *   decision; the standing instruction is that none of them is, so each was
 *   measured and either wired or pointed at its live equivalent.
 */

import { redirect } from "next/navigation";

export default function RetiredPage() {
    redirect("/academy/dashboard");
}
