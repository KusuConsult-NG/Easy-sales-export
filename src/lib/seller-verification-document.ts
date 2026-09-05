/**
 * What a stored seller-verification document reference actually is.
 *
 * WHY THIS EXISTS
 * ---------------
 * #431. /api/marketplace/submit-verification demanded a business registration,
 * an identity document and a proof of address, then stored:
 *
 *     documents: { businessDoc: `placeholder_${businessDoc.name}`, ... }
 *
 * The uploaded bytes went nowhere. The admin review screen turned that string
 * into a link — /api/admin/documents/placeholder_passport.pdf — pointing at a
 * route that reads `_document_uploads`, a table with no writer anywhere in this
 * repository and no migration creating it. Every one of those links 404s.
 *
 * The route now uploads the files and stores their URLs, so new rows carry a
 * real reference. THE ROWS ALREADY WRITTEN DO NOT, and there is no way to
 * recover documents that were never stored — the submitter would have to send
 * them again.
 *
 * So a reviewer must be able to tell the two apart. Rendering a legacy
 * placeholder as "View Document" is the version of this defect that survives
 * the fix: the reviewer clicks, gets a 404, and cannot tell whether the
 * document is missing or the viewer is broken. Naming it plainly is what lets
 * them ask the seller to resubmit.
 *
 * THREE COPIES ON THE SCREEN, ONE RULE HERE. The admin page rendered this
 * expression three times, once per document. That is the shape behind #425,
 * #426 and #429 — the fix reaching one of the copies — so the rule is stated
 * once and called three times.
 */

/** The marker the old route wrote instead of storing the file. */
export const UNSTORED_DOCUMENT_PREFIX = "placeholder_";

export type SellerDocumentState =
    /** Nothing was ever submitted for this slot. */
    | { kind: "absent" }
    /** Submitted, but the route of the day discarded it. Not recoverable. */
    | { kind: "unstored"; fileName: string }
    /** A real stored reference the reviewer can open. */
    | { kind: "stored"; href: string };

/**
 * Classify one stored reference.
 *
 * A value is only treated as openable when it is an absolute http(s) URL or a
 * site-absolute path. Anything else — a bare filename, a placeholder, a
 * fragment of one — is NOT turned into a link, because the failure mode being
 * fixed is precisely a link built out of a string that was never a location.
 */
export function sellerDocumentState(value: unknown): SellerDocumentState {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return { kind: "absent" };

    if (raw.startsWith(UNSTORED_DOCUMENT_PREFIX)) {
        return { kind: "unstored", fileName: raw.slice(UNSTORED_DOCUMENT_PREFIX.length) || "document" };
    }

    if (/^https?:\/\//i.test(raw)) return { kind: "stored", href: raw };
    // A site-absolute path, but never a protocol-relative "//host" one — that
    // is an off-site link wearing a path's clothes (#262's shape).
    if (raw.startsWith("/") && !raw.startsWith("//")) return { kind: "stored", href: raw };

    // A bare filename, or anything else that is not a location. The old route's
    // rows are the known case; treating an unrecognised value as openable is
    // how the broken link got built in the first place.
    return { kind: "unstored", fileName: raw };
}

/** What a reviewer should be told when a document cannot be opened. */
export const UNSTORED_DOCUMENT_MESSAGE =
    "Submitted but not stored — ask the seller to re-upload";
