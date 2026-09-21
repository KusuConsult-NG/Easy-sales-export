/**
 * @jest-environment node
 */

/**
 *   #809 THREE WRITERS, THREE VOCABULARIES, ONE FIELD DECLARED AS ONE VALUE.
 *
 *        `membershipTier` is typed `"Member"` — in types/index.ts and on the
 *        admin members screen. Three paths write it and one wrote that:
 *
 *          payments/service.ts        `normalisedTier = "Member"`        ✓
 *          _dashboard, _coop_identity `paymentData.tier || "Member"`     ✗
 *            (heal a membership from   — the PAYMENT's tier, which is the
 *             its payment row)           retired fee band `tier1`
 *          _coop_identity             `userPlan` first-letter-capitalised
 *            (synthesise an ID card)   — "Premium", "Tier1"              ✗
 *
 *        THE FEE BAND IS NOT THE MEMBERSHIP TIER. `tier1`/`tier2` was a
 *        two-band registration fee, ₦10,000 and ₦20,000. There is one fee now
 *        — flat ₦10,000 — so `tier2` names a price nobody is charged, and
 *        neither name names a membership tier at all.
 *
 *        WHAT IT COSTS. The admin members screen renders the value, so a healed
 *        membership reads "tier1" where every other member reads "Member". And
 *        _cooperative_memberships takes the stored string as `knownTier`, which
 *        the repair screen then writes onto a real membership record — the
 *        retired vocabulary escaping a heal path into the thing it heals.
 *
 *        NOTHING CRASHES, which is why it went unnoticed: getMaxLoanAmount
 *        derives the tier from the contribution rather than reading this field,
 *        and getTierInterestRate and getTierMaxDuration ignore their argument.
 *        Asserted below, so "it is only a label" stays true rather than being
 *        assumed.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    normaliseMembershipTier,
    DEFAULT_COOPERATIVE_TIER,
    COOPERATIVE_TIERS,
    getMaxLoanAmount,
    getTierInterestRate,
    getTierMaxDuration,
} from '@/lib/cooperative-tiers';

// ─────────────────────────────────────────────────────────────────────────────
describe('#809 — the rule', () => {
    it('THE RETIRED FEE BANDS DO NOT SURVIVE IT', () => {
        //   The defect, in the exact spellings the two heal paths stored.
        expect(normaliseMembershipTier('tier1')).toBe('Member');
        expect(normaliseMembershipTier('tier2')).toBe('Member');
        expect(normaliseMembershipTier('Tier1')).toBe('Member');
    });

    it('AND NEITHER DOES A PLAN NAME', () => {
        //   What the ID-card path produced by capitalising `userPlan`.
        for (const plan of ['Premium', 'premium', 'Basic', 'Gold', 'elite']) {
            expect(normaliseMembershipTier(plan)).toBe('Member');
        }
    });

    it('A REAL TIER IS KEPT, whatever case it was stored in', () => {
        //   The direction that must not move. A rule that answered "Member" to
        //   everything would pass both assertions above — and would also be
        //   correct today, with one tier. It must stay correct on the day there
        //   are two, so it is written as a lookup and asserted as one.
        for (const key of Object.keys(COOPERATIVE_TIERS)) {
            expect(normaliseMembershipTier(key)).toBe(key);
            expect(normaliseMembershipTier(key.toUpperCase())).toBe(key);
            expect(normaliseMembershipTier(`  ${key}  `)).toBe(key);
        }
    });

    it('and anything unreadable becomes the default rather than passing through', () => {
        for (const junk of [undefined, null, '', '   ', 42, {}, [], true]) {
            expect(normaliseMembershipTier(junk)).toBe(DEFAULT_COOPERATIVE_TIER);
        }
    });

    /**
     *   THE DAY THERE ARE TWO. With one tier, "look the name up" and "always
     *   answer the default" are the SAME function — both mutants of the lookup
     *   survived the first run of this suite, and neither is a bug today.
     *
     *   The claim worth keeping is about the second tier: a stored name must
     *   win over whatever sorts first. So the tier set is passed in, the way
     *   `isApply(argv = process.argv)` takes its argv, and the claim becomes
     *   measurable instead of aspirational.
     */
    const TWO = ['Member', 'Patron'] as const;

    it('WITH A SECOND TIER, THE STORED NAME WINS over the default', () => {
        expect(normaliseMembershipTier('Patron', TWO)).toBe('Patron');
        expect(normaliseMembershipTier('Member', TWO)).toBe('Member');
    });

    it('AND STILL CASE-INSENSITIVELY, which is why the compare lowercases', () => {
        expect(normaliseMembershipTier('PATRON', TWO)).toBe('Patron');
        expect(normaliseMembershipTier('  patron ', TWO)).toBe('Patron');
    });

    it('AND AN UNKNOWN NAME STILL FALLS BACK to the first tier, not through', () => {
        expect(normaliseMembershipTier('tier2', TWO)).toBe('Member');
        expect(normaliseMembershipTier('Gold', TWO)).toBe('Member');
    });

    it('AND THE FALLBACK COMES FROM THE SET, not from the module default', () => {
        //   `TWO` above opens with 'Member', which is also the module default,
        //   so it cannot tell those two apart — a mutant that ignored the set
        //   entirely survived on it. This set does not start with 'Member'.
        const OTHER = ['Patron', 'Member'] as const;

        expect(normaliseMembershipTier('tier1', OTHER)).toBe('Patron');
        expect(normaliseMembershipTier(undefined, OTHER)).toBe('Patron');
    });

    it('POSITIVE CONTROL: the default is a tier this cooperative has', () => {
        // Otherwise every assertion above could be measuring a default that is
        // itself invented.
        expect(Object.keys(COOPERATIVE_TIERS)).toContain(DEFAULT_COOPERATIVE_TIER);
        expect(DEFAULT_COOPERATIVE_TIER).toBe('Member');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#809 — every writer goes through it', () => {
    const body = (rel: string, fn: string): string => {
        const src = readFileSync(join(process.cwd(), rel), 'utf8');
        const at = src.indexOf(fn);
        expect(at).toBeGreaterThan(-1);
        return src.slice(at, at + 4000);
    };

    it('THE WEBHOOK NORMALISES rather than carrying a correct copy', () => {
        //   This path was already right. A correct copy is still a copy, and
        //   the two heal paths are what drifted from it.
        expect(body('src/infrastructure/payments/service.ts',
            'export async function processCooperativeRegistration'))
            .toContain('normaliseMembershipTier(tier)');
    });

    it('AND SO DOES THE DASHBOARD HEAL PATH — the defect', () => {
        const src = readFileSync(
            join(process.cwd(), 'src/app/actions/cooperative/_dashboard.ts'), 'utf8');

        expect(src).toContain('membershipTier: normaliseMembershipTier(paymentData.tier)');
        expect(src).not.toContain('membershipTier: paymentData.tier ||');
    });

    it('AND THE ID-CARD HEAL PATH, both of its writes', () => {
        const src = readFileSync(
            join(process.cwd(), 'src/app/actions/cooperative/_coop_identity.ts'), 'utf8');

        expect(src).toContain('membershipTier: normaliseMembershipTier(paymentData.tier)');
        expect(src).toContain('membershipTier: normaliseMembershipTier(userPlan)');
        expect(src).not.toContain('userPlan.charAt(0).toUpperCase()');
    });

    it('POSITIVE CONTROL: the search really can find a writer', () => {
        // A `toContain` against a file that failed to load, or a path that
        // moved, is a test that cannot fail.
        const src = readFileSync(
            join(process.cwd(), 'src/app/actions/cooperative/_dashboard.ts'), 'utf8');
        expect(src).toContain('membershipTier');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#809 — and it really was only a label, which the fix does not change', () => {
    /**
     * Why this block exists: "nothing crashes" is the reason this survived, and
     * it is a claim about the loan engine. If any of these DID read the stored
     * tier, a healed membership carrying "tier1" would have been a live money
     * defect rather than a wrong word on a screen — so it is measured.
     */
    it('THE LOAN CAP IS DERIVED FROM THE CONTRIBUTION, not from a stored tier', () => {
        expect(getMaxLoanAmount.length).toBe(1);
        expect(getMaxLoanAmount(100_000)).toBeGreaterThan(0);
    });

    it('AND THE RATE AND DURATION IGNORE THE TIER THEY ARE HANDED', () => {
        //   Including a tier that does not exist — which is what made the
        //   stored "tier1" harmless rather than a TypeError.
        expect(getTierInterestRate('tier1' as never)).toBe(getTierInterestRate('Member'));
        expect(getTierMaxDuration('tier1' as never)).toBe(getTierMaxDuration('Member'));
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/lib/cooperative-tiers.ts and the three writers, this suite
 *   re-run each time alongside two-constants-one-name-and-a-tier-nobody-offers.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   restore `paymentData.tier || "Member"`      1   "AND SO DOES THE DASHBOARD
 *   in _dashboard — the defect                      HEAL PATH"
 *
 *   restore the capitalised userPlan            1   "AND THE ID-CARD HEAL PATH"
 *
 *   normaliser passes an unrecognised           3   "THE RETIRED FEE BANDS DO
 *   string through (`tier1` survives)               NOT SURVIVE IT"
 *
 *   normaliser always returns the default       2   "WITH A SECOND TIER, THE
 *                                                   STORED NAME WINS"
 *
 *   drop the case-insensitive compare           2   "WITH A SECOND TIER, THE
 *                                                   STORED NAME WINS"
 *
 *   fallback ignores the tier set               2   "AND THE FALLBACK COMES
 *                                                   FROM THE SET"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the header comment on the rule       0   SURVIVED ✓
 *
 *   TWO OF THESE SURVIVED THE FIRST RUN, and the reason is the point of the
 *   seam. With ONE tier, "look the name up" and "always answer the default"
 *   are the same function — every mutant of the lookup answers "Member" to
 *   everything, correctly. The tier set became a defaulted parameter, the way
 *   `isApply(argv = process.argv)` takes its argv, and both died at once.
 *
 *   A THIRD SURVIVED AFTER THAT: the first two-tier set opened with 'Member',
 *   which is also the module default, so it could not tell "fallback from the
 *   set" from "fallback from the module". A set opening with 'Patron' can.
 */
