/**
 *   #384 RETIRED — THE SECOND ESCROW ADMIN SCREEN.
 *
 *        197 lines beside /admin/marketplace/escrow's 448, over the same actions,
 *        and only the larger one is in the admin nav. #60's shape: two screens
 *        for one job, and only one of them gets the repairs — #113, #133, #325
 *        and #375 all landed on the linked one.
 *
 *   NOTHING IS DELETED. The implementation is in this file's git history, and
 *   the URL keeps working: anyone holding a link or a bookmark lands on the
 *   screen that does the job. #362 recorded eleven screens like this as an owner
 *   decision; the standing instruction is that none of them is, so each was
 *   measured and either wired or pointed at its live equivalent.
 */

import { redirect } from "next/navigation";

export default function RetiredPage() {
    redirect("/admin/marketplace/escrow");
}
