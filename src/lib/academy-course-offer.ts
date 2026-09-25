/**
 * What a course costs, as structured data may state it — #932.
 *
 *   EVERY ACADEMY COURSE WAS PUBLISHED TO SEARCH ENGINES AS FREE.
 *
 *   app/academy/[courseId]/layout.tsx emits schema.org JSON-LD for each course,
 *   and its offer was a literal:
 *
 *       offers: {
 *           '@type': 'Offer',
 *           price: '0',
 *           priceCurrency: 'NGN',
 *           category: 'Free',
 *       }
 *
 *   Nothing about the course was read. Two ways that is false:
 *
 *     A COURSE WITH A PRICE CAN BE BOUGHT OUTRIGHT. _ac_course_payment charges
 *     `Math.round(course.price * 100)` kobo through Paystack and re-validates the
 *     amount against the same field — so a priced course is genuinely for sale,
 *     and was advertised at ₦0.
 *
 *     A TIERED COURSE NEEDS A PAID PLAN. checkCourseAccess refuses any tier past
 *     "free" without a plan that opens it, and the plans are not free —
 *     academyPlanFee prices all three. An elite course was published as Free to
 *     everybody, including Google.
 *
 *   A price in structured data is a claim to third parties, which makes it worse
 *   than the same claim on a page: the page can be read in context, a rich result
 *   cannot. A "Free" badge on a course that charges is the kind of thing that
 *   reaches a person before the platform gets to explain itself.
 *
 * ── WHY A PLAN-GATED COURSE GETS NO OFFER AT ALL ────────────────────────────
 *
 *   The tempting repair is to publish the plan's fee. That is a second false
 *   claim in the other direction: the plan opens a catalogue, so its fee is not
 *   this course's price, and a shopper told "₦45,000" for one course has been
 *   misled as surely as one told "free".
 *
 *   schema.org makes `offers` optional, so the honest answer is to say nothing
 *   about price and let the page do it. Silence is available; a wrong number is
 *   not.
 *
 * ── AND THE ONE RULE DECIDES WHO IS "FREE" ──────────────────────────────────
 *
 *   `checkCourseAccess(null, tier)` is already the platform's answer to "may
 *   somebody with no plan and no purchase open this", asked by three call sites.
 *   Asking it again here rather than re-deriving `tier === "free"` is what keeps
 *   the published claim and the actual gate from drifting apart — which is the
 *   whole shape of the defect above.
 *
 * Pure: no imports beyond the plan rule, no I/O.
 */

import { checkCourseAccess } from "@/lib/academy-plan";

/** What this module needs off a course row. */
export interface CourseOfferInput {
    price?: unknown;
    tier?: unknown;
}

/** A schema.org Offer, as the JSON-LD block carries it. */
export interface CourseOffer {
    "@type": "Offer";
    price: string;
    priceCurrency: "NGN";
    category: "Free" | "Paid";
    availability: "https://schema.org/InStock";
}

/** A positive, finite amount, or null. */
function amountOf(value: unknown): number | null {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The offer to publish for this course, or `undefined` for "say nothing".
 *
 * THE PRICE IS TESTED FIRST, and deliberately. A row carrying both `tier:
 * "free"` and a price is contradictory — but one of those two facts leads to a
 * payment request and the other does not, so the published claim follows the one
 * that can take somebody's money.
 */
export function courseOfferFor(course: CourseOfferInput): CourseOffer | undefined {
    const price = amountOf(course?.price);
    if (price !== null) {
        return {
            "@type": "Offer",
            price: String(price),
            priceCurrency: "NGN",
            category: "Paid",
            availability: "https://schema.org/InStock",
        };
    }

    //   Open to somebody with no plan and no purchase: the platform's own test,
    //   not a second reading of the tier.
    if (checkCourseAccess(null, course?.tier)) {
        return {
            "@type": "Offer",
            price: "0",
            priceCurrency: "NGN",
            category: "Free",
            availability: "https://schema.org/InStock",
        };
    }

    //   Behind a paid plan and not sold on its own. Neither "free" nor a number
    //   this course can be bought for, so nothing is claimed.
    return undefined;
}

/**
 * `timeRequired` as ISO 8601, or `undefined` when the stored text cannot be
 * expressed that way.
 *
 *   THE FIELD WAS BEING FILLED WITH "4 weeks". schema.org's timeRequired is an
 *   ISO 8601 duration, so prose there is not a mild imprecision — it is a value
 *   consumers discard, which makes the effort of emitting it worth nothing.
 *
 *   Only the shapes the admin form actually produces are converted, and anything
 *   else returns undefined rather than a guess: omitting a field costs a
 *   consumer nothing, while "P0D" for "a few sessions" would be a duration
 *   nobody stated.
 */
export function courseTimeRequired(duration: unknown): string | undefined {
    const text = String(duration ?? "").trim().toLowerCase();
    if (!text) return undefined;

    const match = /^(\d+(?:\.\d+)?)\s*(hour|hr|day|week|month|year)s?$/.exec(text);
    if (!match) return undefined;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    //   A fractional week is not expressible in the date part of ISO 8601, and
    //   "P1.5W" is not valid — so it is left out rather than rounded into a
    //   figure the course does not claim.
    if (!Number.isInteger(amount)) return undefined;

    switch (match[2]) {
        case "hour":
        case "hr":
            return `PT${amount}H`;
        case "day":
            return `P${amount}D`;
        case "week":
            return `P${amount}W`;
        case "month":
            return `P${amount}M`;
        case "year":
            return `P${amount}Y`;
        default:
            return undefined;
    }
}
