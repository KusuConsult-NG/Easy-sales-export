/**
 *   #384 RETIRED — THE TWO ID SCANNERS ARE NOW THE SAME SCANNER.
 *
 *        This page was the CORRECT one: it POSTed to /api/qr/verify, where the
 *        encryption key exists and every attempt is audited, while /verify-id
 *        called the verifier directly in the browser with a key that is
 *        undefined there — so it called every genuine card invalid.
 *
 *        That was fixed: /verify-id now POSTs to the same endpoint, and its own
 *        comment says so. Two identical scanners is one more than the product
 *        needs, and /verify-id is the one anything links to.
 *
 *   NOTHING IS DELETED. The implementation is in this file's git history, and
 *   the URL keeps working: anyone holding a link or a bookmark lands on the
 *   screen that does the job. #362 recorded eleven screens like this as an owner
 *   decision; the standing instruction is that none of them is, so each was
 *   measured and either wired or pointed at its live equivalent.
 */

import { redirect } from "next/navigation";

export default function RetiredPage() {
    redirect("/verify-id");
}
