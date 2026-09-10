/**
 * The papers attached to an export booking.
 *
 *   #590 A BILL OF LADING AND A CERTIFICATE OF ORIGIN, COLLECTED AND SHOWN TO
 *        NOBODY.
 *
 *   The booking wizard asks the exporter to upload both, uploads them to
 *   Cloudinary, and createBookingAction stores them:
 *
 *       documents: {
 *           billOfLading: String(data.billOfLadingUrl ?? ""),
 *           certificateOfOrigin: String(data.certificateOfOriginUrl ?? ""),
 *       },
 *
 *   Both readers return the whole document — getUserBookingsAction and the
 *   admin list both use serializeDocs — so the URLs reach the member's bookings
 *   screen AND the export team's admin screen. Neither draws them. Measured by
 *   sweep: `billOfLading` appears in exactly three files, and the only one that
 *   is a screen is the wizard that uploads it.
 *
 *   So the exporter attaches the two papers that prove a consignment is real,
 *   and then: the export team's screen does not show them, so the team asks for
 *   them again by e-mail; and the exporter cannot see what they sent, so they
 *   cannot tell whether the right file went up.
 *
 *   #348 IS THE SAME FINDING, ONE FIELD SHORT. It rescued the moisture reading,
 *   the foreign-matter percentage, the phytosanitary flag, the shipping terms,
 *   the port and the vessel — "what the wizard collected and then threw away" —
 *   and both screens draw that line today. The two document URLs were stored in
 *   the same commit and drawn by neither.
 *
 * ── WHY A MODULE FOR TWO FIELDS ─────────────────────────────────────────────
 *
 *   Because there are two screens, and #439's lesson is the one this codebase
 *   keeps paying for: a rule stated by hand in every reader is a rule that ends
 *   up applied in most of them. The link guard is the same one first-image
 *   makes for pictures — a stored value that is not an http(s) URL must not
 *   become an anchor — and a booking's `documents` may be absent entirely on
 *   every row written before the wizard collected them.
 */

export interface BookingDocument {
    /** What to call it on screen. */
    label: string;
    url: string;
}

/** Only a value a browser can actually follow. */
function isFollowableUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const url = value.trim();
    return url.startsWith("https://") || url.startsWith("http://");
}

const LABELS: Record<string, string> = {
    billOfLading: "Bill of Lading",
    certificateOfOrigin: "Certificate of Origin",
};

/**
 * The documents on a booking that can be opened, in a stable order.
 *
 * Returns [] — never throws — for every shape a stored booking has been seen to
 * hold: no `documents` key at all, a null, an empty string where a URL was
 * expected, or a bare storage key that is not a URL.
 */
export function bookingDocuments(
    booking: { documents?: unknown } | null | undefined,
): BookingDocument[] {
    const documents = booking?.documents;
    if (!documents || typeof documents !== "object") return [];

    const out: BookingDocument[] = [];
    for (const key of ["billOfLading", "certificateOfOrigin"]) {
        const value = (documents as Record<string, unknown>)[key];
        if (isFollowableUrl(value)) {
            out.push({ label: LABELS[key], url: value.trim() });
        }
    }
    return out;
}
