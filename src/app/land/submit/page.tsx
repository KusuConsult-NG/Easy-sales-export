/**
 * /land/submit — RETIRED. The listing form is /farm-nation/list-land.
 *
 *   #901 A FOUR-STEP WIZARD THAT UPLOADED HER TITLE DEEDS AND THEN REFUSED HER.
 *
 *   Found auditing the files no test had named. Two doors on this platform
 *   write LAND_LISTINGS from a form, and they had drifted a long way apart.
 *
 * ── IT COULD NOT SUCCEED FOR THE PEOPLE IT WAS OPEN TO ──────────────────────
 *
 *   The page gated on `session` alone — any signed-in account reached it. The
 *   action it posts to does not: #486 gave `submitLandListingAction` the
 *   module's access rule, and it refuses anyone without Farm Nation access:
 *
 *       "You need a Farm Nation account to list land. Complete Farm Nation
 *        onboarding first."
 *
 *   That refusal arrives at the END. The four steps run first, and step three
 *   UPLOADS — up to five images and three documents, and the documents this
 *   form asks for are title deeds and survey plans. So an academy student or a
 *   marketplace buyer who found this URL filled in a whole wizard, waited
 *   through every upload, and was then told to go and do onboarding — with her
 *   ownership papers left in storage under her user id and no listing row
 *   pointing at them, so no screen on the platform can show or manage them.
 *
 *   /farm-nation/list-land refuses first: its layout redirects a non-member to
 *   /farm-nation/onboarding before a single field is typed. That form's own
 *   note says why, about a different rule: "a submit that fails late looks like
 *   the platform breaking rather than a form telling her something."
 *
 * ── AND FOR THE PEOPLE IT COULD SUCCEED FOR, IT WROTE A BROKEN LISTING ──────
 *
 *   It offered a Sale / Rent / Lease choice and collected none of what those
 *   choices need. Measured against the sibling door, field for field:
 *
 *     category          NOT ASKED. Required on the other door, and
 *                       searchLandListingsAction's category filter drops any
 *                       row without one — so every parcel listed here was
 *                       invisible to all six browse tiles on /farm-nation.
 *     durationValue     NOT ASKED, on a form that lets her pick "lease". #861's
 *     durationUnit      defect verbatim: "A listing offered for rent with no
 *                       term tells a buyer nothing about what she is being
 *                       offered." leaseTermRefusal deliberately fails open on a
 *                       missing term, so the server saved it.
 *     rentPrice         NOT ASKED. #869 settled that `price` is the SALE price;
 *                       a rent listed here put the annual rent in it, and the
 *                       property page and the checkout both read it as a sale.
 *     gpsCoordinates    NOT ASKED, so the parcel appears on no map (#868).
 *     manageLink        NOT PASSED, so her "we have received your listing"
 *                       notice linked to /land rather than to her listings.
 *
 *   It also conflated two offers the other door keeps separate — a "lease"
 *   was written as `availableForRent: true` as well — which is the hidden
 *   precedence #861 removed from the other form.
 *
 * ── WHAT WAS NOT LOST ───────────────────────────────────────────────────────
 *
 *   The two fields this door collected and the other did not — `soilType` and
 *   `waterSource` — are now on /farm-nation/list-land, from the same lists,
 *   before this one stopped writing. They were worth keeping: four readers want
 *   them, including the crop-suitability search, which is built entirely on the
 *   soil. See lib/land-soil.ts.
 *
 * ── WHY A REDIRECT AND NOT A SECOND COMPLETE FORM ───────────────────────────
 *
 *   Because a second complete form is how this happened. The two doors are 640
 *   and 1,400 lines of the same intent, and every rule added since — #861's
 *   term, #869's rent, #895's minimum lease, #868's picker — reached one of
 *   them. Writing the missing six fields here would leave two forms to keep in
 *   step and the next rule would reach one of them again.
 *
 *   NOTHING IS DELETED. The route still exists and still answers; it sends the
 *   person to the form that works, and every listing already written through it
 *   is untouched and still read — by lib/land-location for its missing
 *   coordinates, by lib/lease-term for its missing term, and by lib/land-soil
 *   for the soil it did record.
 */

import { redirect } from "next/navigation";

/** Where the land listing form lives. One door. */
export const LAND_LISTING_FORM = "/farm-nation/list-land";

export default function SubmitLandListingPage() {
    redirect(LAND_LISTING_FORM);
}
