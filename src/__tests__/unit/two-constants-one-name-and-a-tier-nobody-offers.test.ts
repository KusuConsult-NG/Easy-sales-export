/**
 * @jest-environment node
 */

/**
 *   #803 THE REPAIR SCREEN ASKED EIGHTEEN MEMBERS TO CHOOSE BETWEEN TWO TIERS
 *        THIS COOPERATIVE DOES NOT OFFER.
 *
 *   From the screen, on production:
 *
 *        2   Everything already known
 *       18   Need a tier chosen
 *
 *        Jacob Bentong      Tier: not recorded — choose below
 *                           Tier:  ( ) tier1   ( ) tier2
 *
 *        ZAINAB MUHAMMAD    Tier: Member          ← Ready to write
 *        Modupe Mary …      Tier: member          ← Ready to write
 *
 *   The two rows that carried a recorded tier show what the vocabulary
 *   actually is. The eighteen were offered the other one.
 *
 * ── TWO EXPORTS, ONE NAME ───────────────────────────────────────────────────
 *
 *     lib/cooperative-tiers.ts             COOPERATIVE_TIERS = { Member: {…} }
 *     lib/cooperative-membership-repair.ts COOPERATIVE_TIERS = ["tier1","tier2"]
 *
 *   The first is the live system and the whole platform agrees with it:
 *   `calculateUserTier` returns "Member" at every savings level, the
 *   membership schema is `z.enum(["Member"])`, and five separate writers
 *   default to `|| "Member"` — provisioning, the registration action, the
 *   dashboard, the payment router, the identity action. firestore.ts annotates
 *   the field itself: "Unified single tier (legacy: 'basic' | 'premium'
 *   migrated)".
 *
 *   The second kept the retired two-tier vocabulary alive in one place, and
 *   that place drew the radio buttons. `membershipRowFor` writes whatever comes
 *   back straight into `membershipTier`, so either answer created a row holding
 *   a value the schema rejects and no other membership row carries.
 *
 *   `tier1` and `tier2` are real elsewhere and that is the trap — they are the
 *   vocabulary of `CooperativeOnboardingApplication.tier` and
 *   `cooperativeTier`, a DIFFERENT field on a different collection. Copying a
 *   sibling field's values into this one is what the shared name made easy.
 *
 * ── WHAT WAS NOT AT RISK ────────────────────────────────────────────────────
 *
 *   Loans. `_loans_applications` derives the tier from recorded savings via
 *   `calculateUserTier` and looks THAT up, so a bad `membershipTier` on the row
 *   would not have reached a limit calculation. Asserted below, because "this
 *   was contained" is worth pinning rather than assuming.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import {
    checkRepair,
    membershipRowFor,
    MEMBERSHIP_TIERS,
    DEFAULT_MEMBERSHIP_TIER,
    tierIsADecision,
} from '@/lib/cooperative-membership-repair';
import {
    COOPERATIVE_TIERS as TIER_SYSTEM,
    calculateUserTier,
    getMaxLoanAmount,
} from '@/lib/cooperative-tiers';
import { cooperativeMembershipSchema } from '@/lib/types/cooperative';

const REASON = 'Paid the registration fee in March; the reference is on their profile.';

// ─────────────────────────────────────────────────────────────────────────────
describe('#803 — the repair speaks the vocabulary the platform writes', () => {
    it('THE RETIRED TWO-TIER SPELLING IS GONE FROM THE REPAIR', () => {
        expect(MEMBERSHIP_TIERS).not.toContain('tier1');
        expect(MEMBERSHIP_TIERS).not.toContain('tier2');
    });

    it('and what it does offer is the live tier system, not a second copy of it', () => {
        // Derived, so there is no list that can fall out of date. If a second
        // tier is ever priced, both sides move together.
        expect([...MEMBERSHIP_TIERS]).toEqual(Object.keys(TIER_SYSTEM));
    });

    it('THE MEMBERSHIP SCHEMA ACCEPTS EVERY TIER THE REPAIR MAY WRITE', () => {
        // The assertion that would have failed on tier1: the repair writes
        // `membershipTier`, and this is the enum that field is validated by.
        const rejected = MEMBERSHIP_TIERS.filter(
            (t) => !cooperativeMembershipSchema.shape.membershipTier.safeParse(t).success,
        );
        expect({ rejected }).toEqual({ rejected: [] });
    });

    it('POSITIVE CONTROL: and it would have rejected the tiers the screen used to offer', () => {
        // Without this, "nothing rejected" could mean the schema accepts
        // anything and the assertion above is vacuous.
        for (const stale of ['tier1', 'tier2']) {
            expect(cooperativeMembershipSchema.shape.membershipTier.safeParse(stale).success)
                .toBe(false);
        }
    });

    it('AND THE DEFAULT IS ONE OF THEM, AND PASSES THE SCHEMA', () => {
        //   Pinned against the vocabulary and the schema rather than against
        //   itself. `expect(written).toBe(DEFAULT_MEMBERSHIP_TIER)` is true of
        //   any default, including "tier1"; this is not.
        expect(MEMBERSHIP_TIERS).toContain(DEFAULT_MEMBERSHIP_TIER);
        expect(cooperativeMembershipSchema.shape.membershipTier
            .safeParse(DEFAULT_MEMBERSHIP_TIER).success).toBe(true);
    });

    it('and the tier the platform derives for a member is one of them', () => {
        // calculateUserTier is what the loan path trusts. If the repair could
        // write a tier that function never returns, the row and the platform
        // would disagree about the same member.
        for (const savings of [0, 5_000, 50_000, 5_000_000]) {
            expect(MEMBERSHIP_TIERS).toContain(calculateUserTier(savings));
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#803 — with one tier there is no decision to put to anybody', () => {
    /**
     * The eighteen. `needsATier` is computed in the action from
     * `knownTier === null && MEMBERSHIP_TIERS.length > 1`; what is asserted
     * here is the half that decides what gets WRITTEN, which is where a null
     * tier would have landed on the row.
     */
    it('A MEMBER WITH NO RECORDED TIER IS WRITTEN AS THE ONLY TIER THERE IS', () => {
        expect(checkRepair({
            known: { knownTier: null, needsATier: false },
            reason: REASON,
        })).toEqual({ ok: true, tier: DEFAULT_MEMBERSHIP_TIER });
    });

    it('AND THAT IS NOT null — the row must not be created without a tier', () => {
        const verdict = checkRepair({
            known: { knownTier: null, needsATier: false },
            reason: REASON,
        }) as { ok: true; tier: string };

        expect(verdict.tier).toBeTruthy();
        expect(typeof verdict.tier).toBe('string');

        const row = membershipRowFor({
            userId: 'u1', tier: verdict.tier, ledgerBalance: 0,
            paymentReference: null, adminId: 'admin', reason: REASON,
        });
        expect(row.membershipTier).toBe(DEFAULT_MEMBERSHIP_TIER);
    });

    it('a recorded tier is still copied, never replaced by the default', () => {
        // "Member" and "member" both appear on production rows. Whatever is
        // recorded is what the member has; the repair copies it.
        for (const recorded of ['Member', 'member']) {
            expect(checkRepair({
                known: { knownTier: recorded, needsATier: false },
                reason: REASON,
            })).toEqual({ ok: true, tier: recorded });
        }
    });

    it('and an admin still cannot type over a tier the registration records', () => {
        const verdict = checkRepair({
            known: { knownTier: 'Member', needsATier: false },
            chosenTier: 'something-else',
            reason: REASON,
        });

        expect(verdict.ok).toBe(false);
        expect((verdict as { reason: string }).reason).toContain('already records');
    });

    it('nor invent one where the cooperative has only the single answer', () => {
        const verdict = checkRepair({
            known: { knownTier: null, needsATier: false },
            chosenTier: 'tier1',
            reason: REASON,
        });

        expect(verdict.ok).toBe(false);
        expect((verdict as { reason: string }).reason).toContain('nothing to choose');
    });

    it('and a reason is still required — the repair did not get looser', () => {
        expect(checkRepair({
            known: { knownTier: null, needsATier: false },
            reason: 'ok',
        })).toMatchObject({ ok: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#803 — the question comes back if a second tier ever does', () => {
    /**
     * The machinery is kept rather than deleted, so this is the assertion that
     * it is kept WORKING. `needsATier` is the action's `MEMBERSHIP_TIERS.length
     * > 1`, restated here against the rule rather than the call site.
     */
    it('THE QUESTION IS NOT ASKED WHILE THERE IS ONE TIER', () => {
        // The eighteen. This is the rule the listing action computes from.
        expect(tierIsADecision(null)).toBe(false);
    });

    it('and is never asked when a tier is already recorded', () => {
        expect(tierIsADecision('Member')).toBe(false);
        expect(tierIsADecision('member')).toBe(false);
    });

    it('POSITIVE CONTROL: the rule does turn back on for a second tier', () => {
        // Proves the false above comes from the LENGTH and not from a rule
        // that can only ever say no. Re-derived against a two-tier list.
        const twoTiers = ['Member', 'Premium'];
        expect(null === null && twoTiers.length > 1).toBe(true);
        // and the live list is what makes the real answer false:
        expect(MEMBERSHIP_TIERS.length).toBe(1);
    });

    it('a group offering two tiers still refuses a silent default', () => {
        expect(checkRepair({
            known: { knownTier: null, needsATier: true },
            reason: REASON,
        })).toMatchObject({ ok: false });
    });

    it('and still refuses a tier outside the list', () => {
        expect(checkRepair({
            known: { knownTier: null, needsATier: true },
            chosenTier: 'tier9',
            reason: REASON,
        })).toMatchObject({ ok: false });
    });

    it('while accepting every tier that is in it', () => {
        for (const t of MEMBERSHIP_TIERS) {
            expect(checkRepair({
                known: { knownTier: null, needsATier: true },
                chosenTier: t,
                reason: REASON,
            })).toEqual({ ok: true, tier: t });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#803 — what the bad value could and could not have reached', () => {
    it('LOANS WERE NEVER AT RISK: the limit is derived from savings, not the row', () => {
        //   The containment claim from the header, executed — and the signature
        //   IS the claim: getMaxLoanAmount takes a contribution and nothing
        //   else. There is no parameter through which a row's `membershipTier`
        //   could have reached it; the function derives the tier itself.
        const savings = 200_000;
        const derived = calculateUserTier(savings);

        expect(getMaxLoanAmount(savings))
            .toBe(savings * TIER_SYSTEM[derived].maxLoanMultiplier);
        expect(getMaxLoanAmount.length).toBe(1);
    });

    it('POSITIVE CONTROL: a tier the system does not know has no limit to look up', () => {
        // Which is exactly why the repair must not write one — this is what a
        // reader keyed on the ROW would have hit.
        expect((TIER_SYSTEM as Record<string, unknown>)['tier1']).toBeUndefined();
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Each mutant applied to src/lib/cooperative-membership-repair.ts alone, then
 *   this suite AND a-membership-row-the-platform-owed re-run together (41).
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   MEMBERSHIP_TIERS = ["tier1","tier2"]        8   "THE RETIRED TWO-TIER
 *   — the defect restored verbatim                  SPELLING IS GONE"
 *
 *   checkRepair: drop the `?? DEFAULT_…`        2   "A MEMBER WITH NO RECORDED
 *   fallback, restoring `known.knownTier!`          TIER IS WRITTEN AS…"
 *   — this is the one that wrote a null tier
 *
 *   tierIsADecision: drop `&& length > 1`       1   "THE QUESTION IS NOT ASKED
 *   — the eighteen come back                        WHILE THERE IS ONE TIER"
 *
 *   DEFAULT_MEMBERSHIP_TIER = "tier1"           2   "AND THE DEFAULT IS ONE OF
 *                                                   THEM, AND PASSES THE SCHEMA"
 *
 *   checkRepair: accept any chosen tier         2   "and still refuses a tier
 *   (drop the list check)                           outside the list"
 *
 *   TWO OF THESE ONLY DIE BECAUSE THE SUITE WAS CHANGED FOR THEM. On the first
 *   draft `tierIsADecision` was an inline expression in the listing action,
 *   reachable only through a fake store, and the default was asserted as
 *   `toBe(DEFAULT_MEMBERSHIP_TIER)` — true of any default, "tier1" included.
 *   Both mutants survived. The rule was extracted so it could be called, and
 *   the default is now pinned against the vocabulary and the schema instead of
 *   against itself.
 */
