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
 *   THE ENV OVERRIDES ARE SERVER-SIDE ONLY. MAX_UPLOAD_SIZE_MB and
 *   MAX_VIDEO_UPLOAD_SIZE_MB are read by storage-admin; they are not
 *   NEXT_PUBLIC_, so the browser cannot see them and does not try. A
 *   deployment that lowers either will refuse the file server-side with its
 *   own message — the client bound is a courtesy, never the control.
 */

/** Everything that is not a video. */
export const DEFAULT_MAX_UPLOAD_MB = 50;

/** Video — see the note above. */
export const DEFAULT_MAX_VIDEO_UPLOAD_MB = 200;

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
