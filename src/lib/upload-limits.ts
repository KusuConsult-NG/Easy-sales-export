/**
 * How big an upload may be, stated once for both sides of the wire.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 *   The ceiling is enforced on the SERVER — lib/storage-admin's
 *   uploadSizeLimitBytes, and the two doors that call it — and that is the
 *   only place it is a rule. But the browser has to know the same number, or
 *   it refuses a file the server would have taken, or accepts one it would
 *   not and the person watches a 180MB upload run to the end and fail.
 *
 *   storage-admin cannot be imported into a client component: it pulls in the
 *   logger and the file-type sniffer, which are server code. So the NUMBERS
 *   live here, where both sides can read them, and the ENFORCEMENT stays where
 *   it was. This is the same split session-expiry-code.ts already makes for the
 *   session-expired sentinel, and for the same reason.
 *
 * ── WHY VIDEO IS NOT 50MB ───────────────────────────────────────────────────
 *
 *   A 50MB cap on video is a cap below the size of the thing: a ten-minute
 *   lesson recording does not fit in it. The platform had already decided this
 *   in one place and not the others — actions/resource-actions.ts read
 *   `category === "video" ? 200 * 1024 * 1024 : 50 * 1024 * 1024` while
 *   api/upload, the door most uploads actually use, refused anything over 50MB
 *   whatever it was. The stated rule and the live door disagreed and the door
 *   won.
 *
 * ── AND WHY IT IS NOT 200MB EITHER ──────────────────────────────────────────
 *
 *   THE OWNER: "make the video size 100mb instead of 200mb. file upload for
 *   products on marketplace etc was failing."
 *
 *   A CEILING ABOVE WHAT THE STORAGE BACKEND ACCEPTS IS NOT A CEILING. It is a
 *   promise the platform cannot keep. Cloudinary refuses a single upload over
 *   100MB on the plan this account is on, and our guard let 200MB through — so
 *   a 150MB video passed every check here, uploaded COMPLETELY, and was
 *   rejected at the far end with
 *
 *       File size too large. Got 157286400. Maximum is 104857600.
 *
 *   which api/upload surfaces as a 502. The person waits out the whole upload
 *   and then loses it.
 *
 *   That is the exact failure this file was written to prevent, one layer
 *   further out: the note below says the browser must not "accept one [the
 *   server] would not and the person watches a 180MB upload run to the end and
 *   fail". The same sentence is true of the server and the storage backend, and
 *   it was not being asked. Three parties have to agree, not two — and the
 *   smallest of them decides.
 *
 *   SO THIS NUMBER IS NOT A PREFERENCE. It tracks the storage account's own
 *   per-file limit and must be lowered with it, never raised past it. If the
 *   plan changes, raise MAX_VIDEO_UPLOAD_SIZE_MB on the server rather than
 *   editing this default, and check the new plan's figure first.
 *
 *   THE ENV OVERRIDES ARE SERVER-SIDE ONLY. MAX_UPLOAD_SIZE_MB and
 *   MAX_VIDEO_UPLOAD_SIZE_MB are read by storage-admin; they are not
 *   NEXT_PUBLIC_, so the browser cannot see them and does not try. A
 *   deployment that lowers either will refuse the file server-side with its
 *   own message — the client bound is a courtesy, never the control.
 */

/**
 * Everything that is not a video — which is TWO Cloudinary endpoints, not one.
 *
 *   THE OWNER: "fix the image cap too."
 *
 *   storage-admin's cloudinaryResourceType sends a PDF or a Word document to
 *   `raw` and everything else to `image`, and Cloudinary caps those separately
 *   from video. On the plans where a video may be 100MB — which is the ceiling
 *   this account was found to have — both `image` and `raw` are 10MB. Our
 *   guard said 50, so a 20MB product photo or a scanned title deed passed
 *   every check here, uploaded completely, and was refused at the far end, the
 *   same way the video ceiling was.
 *
 *   LOWERING THIS CANNOT REFUSE ANYTHING THE BACKEND WOULD HAVE TAKEN, which
 *   is the argument for doing it without waiting for the plan to be confirmed.
 *   If Cloudinary's limit really is 10MB then a larger file was already
 *   failing, only later and less clearly — after the whole transfer, with a
 *   502 instead of a sentence. If the plan is in fact higher, the fix is
 *   MAX_UPLOAD_SIZE_MB on the server, not an edit here, and nothing is lost in
 *   the meantime but an early and accurate refusal.
 *
 *   NOT SPLIT INTO image AND raw, though Cloudinary bills them apart and their
 *   ceilings can diverge on larger plans. They are the same number here, and a
 *   third category whose two values are identical is a distinction nobody can
 *   check. uploadSizeLimitBytes already takes the MIME type, so splitting it
 *   later costs one branch.
 */
export const DEFAULT_MAX_UPLOAD_MB = 10;

/** Video — see the note above. Tracks Cloudinary's own per-upload ceiling. */
export const DEFAULT_MAX_VIDEO_UPLOAD_MB = 100;

/**
 * Is this a video, for the purpose of which ceiling applies?
 *
 *   Asked of a MIME type, never of a filename: an extension is a claim about
 *   nothing. Server-side this is asked twice — once of the declared type, to
 *   pick a bound before the bytes are read, and again of the DETECTED type
 *   before anything is stored.
 */
export function isVideoType(type?: string | null): boolean {
    return typeof type === "string" && type.startsWith("video/");
}

/** The default ceiling in megabytes for a file of this type. */
export function defaultLimitMbFor(type?: string | null): number {
    return isVideoType(type) ? DEFAULT_MAX_VIDEO_UPLOAD_MB : DEFAULT_MAX_UPLOAD_MB;
}
