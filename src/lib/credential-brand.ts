/**
 * The palette every credential this platform issues is drawn from.
 *
 *   #808 TWO CREDENTIALS, THREE COLOUR SCHEMES, NO SHARED SOURCE.
 *
 *   The owner asked for the certificate to carry the same branding as the ID
 *   card. It did not, and neither did the second certificate document:
 *
 *       api/id-card/pdf                purple → indigo gradient   the ID card
 *       components/pdf/Certificate…    #7C3AED violet             the live cert
 *       components/CertificateGener…   #10b981 emerald            an orphan
 *
 *   Three schemes across two credentials, each hard-coded at its own call site.
 *   Recolouring the certificate to match would have fixed the symptom and left
 *   the cause — the next edit to either document drifts them apart again, which
 *   is exactly how they got here.
 *
 *   So the colours live here and both documents import them. "Same branding" is
 *   now a fact about the code rather than a coincidence between two files.
 *
 * ── WHY THIS IS NOT `--primary` ─────────────────────────────────────────────
 *
 *   globals.css declares `--primary: #2E519F`, a blue, and that is genuinely
 *   the app's colour — it is what the logo is and what the screens use.
 *
 *   The credentials are not that blue and never were. The ID card has been a
 *   purple-to-indigo gradient in production for as long as it has existed, and
 *   when the certificate was recoloured to the app's blue the owner's answer
 *   was that the purple version was better. That is the deciding fact and it is
 *   recorded here rather than quietly overridden: the printed credentials are a
 *   deliberate second family, and this module is its definition.
 *
 *   If the two families should ever be merged, that is a design decision about
 *   the ID card as much as the certificate, and it is made by changing THIS
 *   FILE — which is the point of it existing.
 */

/**
 * The membership ID card's gradient, measured from the card itself.
 *
 * These are the values `/api/id-card/pdf` has always drawn, extracted rather
 * than reinvented, so the certificate matches the card people already hold
 * instead of matching a fresh guess at what the card looks like.
 */
export const CREDENTIAL_BRAND = {
    /** Gradient start — the deep purple the card opens on. */
    purpleDeep: "#6b21a8",
    /** Gradient midpoint. The most characteristic single colour on the card. */
    purple: "#7e22ce",
    /** Gradient end — the indigo the card closes on. */
    indigo: "#3730a3",
    /** The darkest purple on the card: the tier badge's lettering. */
    purpleInk: "#581c87",
    /** The light lavender the card uses for accents on a dark ground. */
    lavender: "#c4b5fd",
    /** The muted lavender the card labels its detail rows in. */
    lavenderMuted: "#a088d8",
} as const;

/**
 * The gradient, in order, for surfaces that can only draw flat bands.
 *
 * @react-pdf has no dependable linear-gradient, so the certificate echoes the
 * card's gradient as three adjacent segments in the same order rather than
 * flattening it to one colour and losing the thing that makes the card
 * recognisable.
 */
export const CREDENTIAL_GRADIENT = [
    CREDENTIAL_BRAND.purpleDeep,
    CREDENTIAL_BRAND.purple,
    CREDENTIAL_BRAND.indigo,
] as const;
