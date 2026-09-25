/**
 * @jest-environment node
 */

/**
 *   #932 EVERY ACADEMY COURSE WAS PUBLISHED TO SEARCH ENGINES AS FREE.
 *
 *   Found auditing src/app/academy/[courseId]/layout.tsx — one of the files no
 *   test had named. It emits schema.org JSON-LD per course, and its offer was a
 *   literal:
 *
 *       offers: {
 *           '@type': 'Offer',
 *           price: '0',
 *           priceCurrency: 'NGN',
 *           category: 'Free',
 *       }
 *
 *   Nothing about the course was read. Two ways that is false, both live:
 *
 *     A PRICED COURSE CAN BE BOUGHT OUTRIGHT. _ac_course_payment charges
 *     `Math.round(course.price * 100)` kobo through Paystack and re-validates the
 *     amount against the same field. So it was advertised at ₦0.
 *
 *     A TIERED COURSE NEEDS A PAID PLAN. checkCourseAccess refuses any tier past
 *     "free" without a plan that opens it, and academyPlanFee prices all three
 *     plans. An elite course was published as Free to everybody, Google included.
 *
 *   A price in structured data is a claim to third parties, which is worse than
 *   the same claim on a page: the page can be read in context, a rich result
 *   cannot.
 *
 * ── AND IT WAS THE ONLY ONE OF THREE ────────────────────────────────────────
 *
 *   Swept: this application emits JSON-LD from three layouts. The Farm Nation
 *   property and marketplace product blocks both write
 *
 *       offers: price ? { … price: String(price) … } : undefined
 *
 *   reading the real figure and saying NOTHING when there is none. The academy
 *   layout is the one that published a literal, so the shape used here is the
 *   one already shipping next door rather than an invention.
 *
 * ── WHY A PLAN-GATED COURSE GETS NO OFFER AT ALL ────────────────────────────
 *
 *   Publishing the plan's fee would be a second false claim in the other
 *   direction: the plan opens a catalogue, so its fee is not this course's price,
 *   and a shopper told "₦45,000" for one course is misled as surely as one told
 *   "free". schema.org makes `offers` optional, so silence is available and a
 *   wrong number is not.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { courseOfferFor, courseTimeRequired } from '@/lib/academy-course-offer';
import { checkCourseAccess, ACADEMY_PLANS } from '@/lib/academy-plan';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

const LAYOUT = 'src/app/academy/[courseId]/layout.tsx';
const SIBLINGS = [
    'src/app/farm-nation/property/[id]/layout.tsx',
    'src/app/marketplace/products/[id]/layout.tsx',
];

const courseDoc = jest.fn<any>();
jest.mock('@/lib/firebase-admin', () => ({
    getAdminDb: () => ({
        collection: () => ({ doc: () => ({ get: async () => courseDoc() }) }),
    }),
}));

/** The JSON-LD the layout would publish for this course row. */
async function publishedFor(data: Record<string, unknown> | null): Promise<any> {
    courseDoc.mockReturnValue(
        data === null
            ? { exists: false, data: () => undefined }
            : { exists: true, data: () => data },
    );

    const { generateMetadata } = await import('@/app/academy/[courseId]/layout');
    const meta: any = await (generateMetadata as any)({ params: Promise.resolve({ courseId: 'c1' }) });
    const raw = meta?.other?.['application/ld+json'];
    return typeof raw === 'string' ? JSON.parse(raw) : null;
}

const PAID_COURSE = {
    title: 'Export Documentation Masterclass',
    description: 'Everything a first-time exporter has to file, in order.',
    instructor: 'Dr. Kusu',
    duration: '12 weeks',
    price: 25_000,
    tier: 'elite',
};

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#932 — the rule, and the gate it agrees with', () => {
    it('A PRICED COURSE IS PAID, AT ITS OWN PRICE', () => {
        expect(courseOfferFor({ price: 25_000, tier: 'elite' })).toEqual({
            '@type': 'Offer',
            price: '25000',
            priceCurrency: 'NGN',
            category: 'Paid',
            availability: 'https://schema.org/InStock',
        });
    });

    it('A FREE COURSE IS FREE — the control', () => {
        //   Without this the rule could be "never say free", which would be a
        //   different lie about a genuinely free course.
        for (const tier of ['free', '', undefined, null]) {
            const offer = courseOfferFor({ price: 0, tier });
            expect({ tier, category: offer?.category, price: offer?.price })
                .toEqual({ tier, category: 'Free', price: '0' });
        }
    });

    it('AND A PLAN-GATED COURSE SAYS NOTHING AT ALL', () => {
        //   The finding. Neither free nor individually priced, so no claim.
        for (const tier of ['foundation', 'standard', 'elite']) {
            expect({ tier, offer: courseOfferFor({ price: 0, tier }) })
                .toEqual({ tier, offer: undefined });
        }
        //   Absent and unparseable prices are the same case as zero.
        expect(courseOfferFor({ tier: 'elite' })).toBeUndefined();
        expect(courseOfferFor({ price: 'free', tier: 'elite' })).toBeUndefined();
        expect(courseOfferFor({ price: -100, tier: 'elite' })).toBeUndefined();
    });

    it('THE PRICE WINS OVER A CONTRADICTORY TIER, because it takes the money', () => {
        //   A row saying `tier: "free"` AND carrying a price is contradictory, and
        //   only one of those two facts leads to a payment request.
        expect(courseOfferFor({ price: 5_000, tier: 'free' })?.category).toBe('Paid');
        expect(courseOfferFor({ price: 5_000, tier: 'free' })?.price).toBe('5000');
    });

    it('AND "FREE" MEANS EXACTLY WHAT THE PLATFORM’S OWN GATE MEANS', () => {
        /*
         *   The property that keeps the published claim and the actual gate from
         *   drifting: a course is advertised free if and only if somebody with no
         *   plan and no purchase may open it. Asserted across every tier the
         *   platform sells, plus the free and absent cases.
         */
        for (const tier of [...ACADEMY_PLANS, 'free', '', undefined]) {
            const open = checkCourseAccess(null, tier);
            const advertisedFree = courseOfferFor({ price: 0, tier })?.category === 'Free';

            expect({ tier, open, advertisedFree }).toEqual({ tier, open, advertisedFree: open });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#932 — timeRequired is ISO 8601 or absent', () => {
    it('THE SHAPES THE ADMIN FORM PRODUCES CONVERT', () => {
        expect(courseTimeRequired('12 weeks')).toBe('P12W');
        expect(courseTimeRequired('4 weeks')).toBe('P4W');
        expect(courseTimeRequired('1 week')).toBe('P1W');
        expect(courseTimeRequired('3 days')).toBe('P3D');
        expect(courseTimeRequired('6 months')).toBe('P6M');
        expect(courseTimeRequired('4 hours')).toBe('PT4H');
        expect(courseTimeRequired('  8 WEEKS  ')).toBe('P8W');
    });

    it('AND ANYTHING ELSE IS OMITTED rather than guessed', () => {
        //   "P0D" for "a few sessions" would be a duration nobody stated, and a
        //   fractional week is not expressible in the date part of ISO 8601.
        for (const text of ['a few sessions', 'self-paced', '', '   ', '1.5 weeks', '0 weeks',
            '90 minutes', 'twelve weeks', undefined, null, 12]) {
            expect({ text, iso: courseTimeRequired(text) }).toEqual({ text, iso: undefined });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#932 — and what the layout actually publishes', () => {
    it('A PAID COURSE IS PUBLISHED AT ITS PRICE', async () => {
        const published = await publishedFor(PAID_COURSE);

        expect(published['@type']).toBe('Course');
        expect(published.offers).toEqual({
            '@type': 'Offer',
            price: '25000',
            priceCurrency: 'NGN',
            category: 'Paid',
            availability: 'https://schema.org/InStock',
        });
        expect(published.timeRequired).toBe('P12W');
    });

    it('A PLAN-GATED COURSE IS PUBLISHED WITH NO OFFER KEY AT ALL', async () => {
        //   JSON.stringify drops an undefined value, so "say nothing" really is
          //   nothing on the wire — asserted rather than assumed.
        const published = await publishedFor({ ...PAID_COURSE, price: 0 });

        expect('offers' in published).toBe(false);
        //   And the rest of the block still describes the course.
        expect(published.name).toBe(PAID_COURSE.title);
        expect(published.provider?.name).toBe('Easy Sales Academy');
    });

    it('A GENUINELY FREE COURSE IS STILL PUBLISHED AS FREE — the control', async () => {
        const published = await publishedFor({ ...PAID_COURSE, price: 0, tier: 'free' });

        expect(published.offers?.category).toBe('Free');
        expect(published.offers?.price).toBe('0');
    });

    it('and prose in duration leaves timeRequired out', async () => {
        const published = await publishedFor({ ...PAID_COURSE, duration: 'self-paced' });

        expect('timeRequired' in published).toBe(false);
    });

    it('a missing course still answers, with no JSON-LD to be wrong', async () => {
        courseDoc.mockReturnValue({ exists: false, data: () => undefined });
        const { generateMetadata } = await import('@/app/academy/[courseId]/layout');
        const meta: any = await (generateMetadata as any)({ params: Promise.resolve({ courseId: 'gone' }) });

        expect(meta.title).toBe('Course Not Found');
        expect(meta.other).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#932 — the three JSON-LD layouts, swept', () => {
    it('NONE OF THEM WRITES A PRICE LITERAL', () => {
        for (const rel of [LAYOUT, ...SIBLINGS]) {
            const src = code(rel);

            expect({ rel, literal: /price:\s*'0'/.test(src) }).toEqual({ rel, literal: false });
            expect({ rel, literal: /category:\s*'Free'/.test(src) }).toEqual({ rel, literal: false });
        }
    });

    it('AND EACH ONE CAN OMIT ITS OFFER', () => {
        //   The siblings were already written this way — `offers: price ? … :
        //   undefined` — which is why the academy fix is that shape rather than a
        //   new convention.
        for (const rel of SIBLINGS) {
            expect({ rel, guarded: code(rel).includes('offers: price ?') })
                .toEqual({ rel, guarded: true });
        }
        expect(code(LAYOUT)).toContain('courseOfferFor(');
        expect(code(LAYOUT)).toContain('offers,');
    });

    it('POSITIVE CONTROL: the stripper left all three behind', () => {
        for (const rel of [LAYOUT, ...SIBLINGS]) {
            expect({ rel, big: code(rel).includes('schema.org') }).toEqual({ rel, big: true });
        }
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   restore the `price: '0', category: 'Free'`      "A PAID COURSE IS PUBLISHED
 *     literal in the layout (the defect)            AT ITS PRICE", "A PLAN-GATED
 *                                                   COURSE … NO OFFER KEY" and
 *                                                   the sweep
 *   courseOfferFor returns Free for a paid tier     "AND A PLAN-GATED COURSE
 *                                                   SAYS NOTHING" and the gate
 *                                                   agreement test
 *   courseOfferFor tests the tier before the price  "THE PRICE WINS OVER A
 *                                                   CONTRADICTORY TIER"
 *   courseOfferFor returns undefined always        "A FREE COURSE IS FREE"
 *   courseTimeRequired passes prose through         "AND ANYTHING ELSE IS
 *                                                   OMITTED"
 *   courseTimeRequired rounds 1.5 weeks to P2W      the same test
 */
