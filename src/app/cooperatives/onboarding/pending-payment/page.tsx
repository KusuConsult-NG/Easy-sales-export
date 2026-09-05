/**
 *   #384 RETIRED — AND NEITHER DOES THE PENDING-PAYMENT WAIT.
 *
 *        Nothing routed here. The onboarding page itself computes paymentStatus
 *        server-side on every visit and shows the step that matches, so it IS
 *        the "where am I up to" screen — which makes this one a second answer to
 *        a question already answered.
 *
 *        It also carried an "Upload Receipt" control that persisted nothing,
 *        under a promise that it would be reviewed — recorded in
 *        cooperative-inert-controls.test.ts. Retiring the screen retires the
 *        promise with it.
 *
 *   NOTHING IS DELETED. The implementation is in this file's git history, and
 *   the URL keeps working: anyone holding a link or a bookmark lands on the
 *   screen that does the job. #362 recorded eleven screens like this as an owner
 *   decision; the standing instruction is that none of them is, so each was
 *   measured and either wired or pointed at its live equivalent.
 */

import { redirect } from "next/navigation";

export default function RetiredPage() {
    redirect("/cooperatives/onboarding");
}
