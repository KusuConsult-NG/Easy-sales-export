/**
 * @jest-environment node
 */

/**
 *   #969 THE BRIEF SAID LOANS REQUIRE A MINIMUM MEMBERSHIP PERIOD. NOTHING
 *        ANYWHERE CHECKED ONE.
 *
 *   The operational brief prepared for counsel stated that loan applications
 *   "require minimum active membership duration, verified guarantors within the
 *   cooperative, and are capped against the member's aggregate savings ratio".
 *
 *   Measured against the code, two of those three were real. isEligibleForLoan
 *   enforced exactly four things — a positive amount, a non-negative recorded
 *   balance, the ₦5,000 minimum contribution, and
 *   `(requested + outstanding) <= 0.5 x contribution`. There was no duration test
 *   in the tree: no months-of-membership arithmetic, and no reader of any join
 *   date on the eligibility path at all. A member could pay in ₦5,000 and borrow
 *   ₦2,500 the same afternoon.
 *
 *   Asked which was wrong — the brief or the code — the owner confirmed the rule
 *   is real and set the period at THREE MONTHS.
 *
 * ── THE FIELD THE OBVIOUS IMPLEMENTATION WOULD HAVE USED DOES NOT EXIST ─────
 *
 *   `CooperativeMember.joinedAt` is declared on the type. It has NO WRITER: both
 *   creation sites in _coop_registration.ts write `createdAt`, neither writes
 *   `joinedAt`, and api/admin/verify-id/lookup already works around that by
 *   reading `membData?.createdAt` and calling the result joinedAt.
 *
 *   A gate built on `joinedAt` would have compared against `undefined` for every
 *   member in the database. Which way that failed would depend entirely on how
 *   the comparison was written, and the fail-open direction — every loan allowed,
 *   silently, exactly as before — is indistinguishable from the gate working.
 *   That is the defect this whole audit keeps finding, so the test for it is
 *   first-class below rather than implied.
 *
 *   The rule used instead is the one _coop_identity.ts already settled on for the
 *   ID card: `approvedAt` when the admin approved, falling back to `createdAt`
 *   when they applied. It now lives in lib/cooperative-membership-age so the ID
 *   card and the loan gate cannot drift, which is #330's shape.
 *
 * ── AND THE PARAMETER IS REQUIRED, WHICH IS THE ROLLOUT MECHANISM ───────────
 *
 *   isEligibleForLoan takes the membership row as a REQUIRED argument. An
 *   optional one would have let all three call sites keep compiling untouched
 *   while the gate did nothing — a rule present in the source and absent from the
 *   product. Required means tsc names every path that has to supply it, and it
 *   named exactly three production files and four test files.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     unknown start date treated as eligible                KILLED
 *     createdAt preferred over approvedAt                   KILLED
 *     90 days instead of three calendar months              KILLED
 *     duration checked AFTER the contribution floor         KILLED
 *     the period changed to one month                       KILLED ×3
 *     the check removed from isEligibleForLoan entirely     KILLED ×3
 *     reword this header                                    SURVIVED, intended
 *
 *   THE 90-DAY MUTANT SURVIVED THE FIRST RUN, and the fixture was why. That test
 *   was written on 1 December to 1 March — which is 31 + 31 + 28 days, exactly 90.
 *   The one interval in the year where both rules give the same answer, so a test
 *   whose entire subject is that they differ could not tell them apart.
 *
 *   It now runs on 1 March to 30 May: 90 days, but only 89 days short of three
 *   calendar months, so the two answers diverge. Recorded rather than quietly
 *   corrected, because a boundary test that happens to pick a coinciding boundary
 *   is asserting its own fixture, and I have now done that twice in this audit —
 *   the delivery estimate was the other way round, measuring milliseconds against
 *   a promise made in days.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isEligibleForLoan, COOPERATIVE_TIERS } from '@/lib/cooperative-tiers';
import {
    LOAN_MIN_MEMBERSHIP_MONTHS,
    hasMinimumMembership,
    membershipActiveSince,
    toDateOrNull,
} from '@/lib/cooperative-membership-age';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const monthsBefore = (n: number) => {
    const d = new Date(NOW.getTime());
    d.setMonth(d.getMonth() - n);
    return d;
};

/** Comfortably above the ₦5,000 floor, and a request well inside the 0.5x cap. */
const SAVINGS = 200_000;
const ASK = 10_000;

const eligibility = (member: unknown) =>
    isEligibleForLoan(SAVINGS, ASK, 0, member as any, NOW);

// ─────────────────────────────────────────────────────────────────────────────
describe('#969 — three months of active membership, or no loan', () => {
    it('THE test: a member approved this week cannot borrow', async () => {
        //   The defect, executed. Before this, ₦5,000 in and ₦2,500 out the same
        //   afternoon satisfied every check there was.
        const r = eligibility({ approvedAt: monthsBefore(0) });

        expect(r.eligible).toBe(false);
        expect(r.reason).toMatch(/3 months of active membership/i);
    });

    it('and one approved four months ago can', () => {
        expect(eligibility({ approvedAt: monthsBefore(4) })).toEqual({ eligible: true });
    });

    it('and the boundary is inclusive: exactly three months qualifies', () => {
        //   A member told "three months" is eligible ON that day, not the day
        //   after. Off by one here is a person refused at a counter.
        expect(eligibility({ approvedAt: monthsBefore(LOAN_MIN_MEMBERSHIP_MONTHS) }))
            .toEqual({ eligible: true });
    });

    it('AND AN UNKNOWN START DATE REFUSES — it does not wave the member through', () => {
        /*
         *   #744's direction, which is the whole reason this is a named test.
         *   `undefined >= threshold` is false and `undefined < threshold` is also
         *   false, so a date that cannot be read will either refuse everybody or
         *   admit everybody depending on which way the comparison happens to be
         *   written — and one of those two is invisible.
         *
         *   The refusal says something different from "wait longer", because this
         *   one needs a human rather than patience.
         */
        for (const member of [null, undefined, {}, { approvedAt: 'not a date' }, { createdAt: NaN }]) {
            const r = eligibility(member);
            expect({ member, eligible: r.eligible }).toEqual({ member, eligible: false });
            expect(r.reason).toMatch(/could not be read/i);
        }
    });

    it('AND IT IS CHECKED BEFORE THE MONEY RULES, so the refusal names what is actually in the way', () => {
        /*
         *   #322. A brand-new member with ₦0 saved fails both the period and the
         *   ₦5,000 floor. Told about the floor, they would go and deposit ₦5,000
         *   and be refused again — the deposit cannot fix the thing stopping them.
         */
        const r = isEligibleForLoan(0, ASK, 0, { approvedAt: monthsBefore(0) }, NOW);

        expect(r.eligible).toBe(false);
        expect(r.reason).toMatch(/membership/i);
        expect(r.reason).not.toMatch(new RegExp(String(COOPERATIVE_TIERS.Member.minContribution)));
    });

    it('AND THE DATA-SANITY REFUSALS STILL COME FIRST', () => {
        //   An unreadable REQUEST is not a policy decision and must not be
        //   reported as a membership problem — #745's floor, unchanged, and the
        //   reason the duration check sits below those two and not at the top.
        const longStanding = { approvedAt: monthsBefore(12) };

        expect(isEligibleForLoan(SAVINGS, 0, 0, longStanding, NOW).reason)
            .toMatch(/greater than zero/i);
        expect(isEligibleForLoan(SAVINGS, NaN, 0, longStanding, NOW).reason)
            .toMatch(/could not be read/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('which date membership starts from', () => {
    it('approvedAt WINS over createdAt — applying is not joining', () => {
        /*
         *   The rule _coop_identity.ts already stated for the ID card: "Issue date
         *   = approvedAt (when admin approved) — not createdAt (when applied)."
         *
         *   It matters in the permissive direction. Somebody who applied four
         *   months ago and was approved last week has one week of ACTIVE
         *   membership, and reading createdAt would hand them a loan on the
         *   strength of time spent waiting in a queue.
         */
        const since = membershipActiveSince({
            createdAt: monthsBefore(4),
            approvedAt: monthsBefore(1),
        });

        expect(since?.toISOString()).toBe(monthsBefore(1).toISOString());
        expect(hasMinimumMembership(since, LOAN_MIN_MEMBERSHIP_MONTHS, NOW)).toBe(false);
    });

    it('and createdAt is the fallback, for rows approved before approvedAt existed', () => {
        const since = membershipActiveSince({ createdAt: monthsBefore(9) });
        expect(since?.toISOString()).toBe(monthsBefore(9).toISOString());
    });

    it('AND `joinedAt` IS NOT CONSULTED, BECAUSE NOTHING WRITES IT', () => {
        /*
         *   The trap this finding walked up to. `joinedAt` is on the
         *   CooperativeMember type and is the field a reader would reach for.
         *   Neither creation site writes it.
         *
         *   Asserted from both ends: the rule ignores it, and the registration
         *   that creates these rows still does not write it. If somebody starts
         *   writing it, the second assertion fails and this decision gets re-made
         *   deliberately instead of the fallback quietly going stale.
         */
        expect(membershipActiveSince({ joinedAt: monthsBefore(24) } as any)).toBeNull();

        const registration = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/cooperative/_coop_registration.ts'), 'utf-8'),
            { label: '_coop_registration.ts' },
        );
        expect(registration).not.toMatch(/joinedAt\s*:/);
    });

    it('and the date shapes these rows actually hold are all read', () => {
        //   JSONB round-trips a Firestore Timestamp into `{ seconds }`, and
        //   through JSON.stringify into `{ _seconds }`. A reader that knows only
        //   `toDate()` returns null for a date that is really there — which, given
        //   the rule above, refuses a member who has waited long enough.
        const epoch = Date.UTC(2026, 0, 1);
        for (const shape of [
            new Date(epoch),
            new Date(epoch).toISOString(),
            epoch,
            { seconds: epoch / 1000 },
            { _seconds: epoch / 1000 },
            { toDate: () => new Date(epoch) },
        ]) {
            expect({ shape, ms: toDateOrNull(shape)?.getTime() })
                .toEqual({ shape, ms: epoch });
        }
    });

    it('and nothing unreadable comes back as a date', () => {
        for (const bad of [null, undefined, '', 'tuesday', NaN, Infinity, {}, [], new Date('x')]) {
            expect({ bad, d: toDateOrNull(bad) }).toEqual({ bad, d: null });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('calendar months, not ninety days', () => {
    it('THE WINDOW IS CALENDAR MONTHS', () => {
        /*
         *   "Three months" to a member means the same day of the month, three
         *   months on. Counting 90 days makes the rule land on a different date
         *   depending on which months it spans: a membership approved on 1
         *   December reaches three calendar months on 1 March, but 90 days only on
         *   1 March in a leap year and 2 March otherwise.
         *
         *   a-delivery-estimate-is-a-day-not-a-minute recorded this trap from the
         *   other side — measuring elapsed milliseconds against a promise made in
         *   calendar days, and getting 7.6.
         */
        //   MARCH TO JUNE, chosen because it DISCRIMINATES. My first version of
        //   this test used 1 December to 1 March, which is exactly 90 days — the
        //   one interval where both rules give the same answer — so the 90-day
        //   mutant survived it. A test of "these two rules differ" has to be run
        //   on dates where they differ, and picking a boundary that happens to
        //   coincide is how a test asserts its own fixture.
        //
        //   1 March to 1 June is 92 days. 90 days lands on 30 May.
        const mar1 = new Date('2027-03-01T09:00:00.000Z');
        const may30 = new Date('2027-05-30T09:00:00.000Z');
        const jun1 = new Date('2027-06-01T09:00:00.000Z');

        //   On 30 May a 90-day rule says yes and three calendar months says no.
        expect(hasMinimumMembership(mar1, 3, may30)).toBe(false);
        //   And on 1 June the calendar rule is satisfied.
        expect(hasMinimumMembership(mar1, 3, jun1)).toBe(true);

        //   The other direction, where a 30-day month makes 90 days LATE: a
        //   membership from 1 December reaches three calendar months on 1 March,
        //   which a 31+31+28 count also reaches — so February is the month that
        //   makes the two rules agree, and November is not.
        const nov1 = new Date('2026-11-01T09:00:00.000Z');
        const feb1 = new Date('2027-02-01T09:00:00.000Z');
        expect(hasMinimumMembership(nov1, 3, feb1)).toBe(true);
    });

    it('AND THE PERIOD IS THREE, STATED ONCE', () => {
        //   Named so changing the policy is one edit that reaches all three
        //   application paths — the argument api/cooperative/apply-loan makes in
        //   its own words about the 2x requirement it had open-coded.
        expect(LOAN_MIN_MEMBERSHIP_MONTHS).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('every application path supplies it', () => {
    /*
     *   THE ROLLOUT, ASSERTED. The parameter being required means tsc refuses a
     *   call site that omits it — but tsc does not run in jest, so a path could be
     *   added with `as any` or a bare `null` and this suite would not notice.
     *
     *   Three doors create loan applications and all three reach isEligibleForLoan.
     *   Each must hand it the member row it has ALREADY READ, not a fresh literal:
     *   a `{}` passed to satisfy the compiler would refuse every borrower, which
     *   is at least visible — but a hand-built object with today's date would
     *   admit every one, silently, and that is the shape to forbid.
     */
    const DOORS = [
        'src/app/actions/cooperative/_loans_applications.ts',
        'src/app/actions/cooperative/_coop_money.ts',
        'src/app/api/cooperative/apply-loan/route.ts',
    ];

    it('ALL THREE DOORS PASS A MEMBERSHIP ROW THEY READ', () => {
        for (const door of DOORS) {
            const src = stripComments(
                readFileSync(join(process.cwd(), door), 'utf-8'), { label: door },
            );
            const call = /isEligibleForLoan\(([\s\S]*?)\);/.exec(src);
            expect({ door, found: Boolean(call) }).toEqual({ door, found: true });

            const args = call![1];
            //   The fourth argument is one of the names each door already bound
            //   for the row it read — never a literal.
            expect({ door, passesRow: /member(ship)?(Data|Row)/i.test(args) })
                .toEqual({ door, passesRow: true });
            expect({ door, literal: /\{\s*(approvedAt|createdAt|)\s*[:}]/.test(args) })
                .toEqual({ door, literal: false });
        }
    });

    it('AND NO DOOR BUILDS A DATE TO GET PAST THE GATE', () => {
        //   The one way to defeat this rule without touching it: hand it
        //   `{ approvedAt: new Date() }` — or a Date at all — at the call site.
        for (const door of DOORS) {
            const src = stripComments(
                readFileSync(join(process.cwd(), door), 'utf-8'), { label: door },
            );
            const call = /isEligibleForLoan\(([\s\S]*?)\);/.exec(src)![1];
            expect({ door, fabricated: /new Date|Date\.now/.test(call) })
                .toEqual({ door, fabricated: false });
        }
    });
});
