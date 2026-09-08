/**
 * @jest-environment node
 */

/**
 *   #497 THE PAYMENT CONDITION WAS ENFORCED ON THE WAY IN AND NEVER AFTERWARDS.
 *
 *   #496 closed the cooperative ID CARD against a member who had not paid. It
 *   recorded the door it could not close in the same breath, because closing it
 *   needed its own measurement:
 *
 *       "checkModuleAccess Layer 2 grants the cooperative module on
 *        `membershipStatus` alone, so the heal's write still opens the module
 *        for an unpaid member even now the card is gated."
 *
 *   That door is Layer 2.6, and this is it:
 *
 *       const isApprovedOrActive = status === "active" || status === "approved";
 *       const isHealable = !isApprovedOrActive && … && paymentStatus === "completed";
 *       if (isApprovedOrActive || isHealable) { …grant… }
 *
 *   `isHealable` demands a completed payment before PROMOTING anybody to active.
 *   So the author of this layer plainly held that paying matters. And then
 *   `isApprovedOrActive` granted the same access to anyone already carrying
 *   `membershipStatus: "active"` without ever asking.
 *
 *   "Already carrying" is not rare. #496 found _coop_identity's heal writing
 *   that exact field from central status alone, and _legacy.ts:657,
 *   _coop_membership.ts:307 and _dashboard.ts:252 each write it by their own
 *   route. A rule checked at one entrance and at none of the other four is not a
 *   rule — #486's class, fifth appearance.
 *
 *   AND THIS DOOR IS WIDER THAN THE CARD. Layer 2.6 is the cooperative MODULE:
 *   savings, contributions, loans, withdrawals. The ID card was the smaller half.
 *
 * ── MEASURED BEFORE THE GATE MOVED ──────────────────────────────────────────
 *
 *       active with payment not completed                 77
 *         ...legacy, exempt by design and still exempt     74
 *         ...non-legacy                                     3
 *           ...with a real payment in processed_payments     1  (fallback finds)
 *           ...with no payment anywhere                      2  (now refused)
 *
 *   THE LEGACY EXEMPTION IS WHY THIS IS SAFE TO SHIP. Seventy-four of the
 *   seventy-seven joined before the platform charged anything. A payment
 *   requirement without that carve-out would lock the entire pre-platform
 *   membership out of their own savings to catch two people, which is how a
 *   repair becomes the outage this owner keeps reporting.
 *
 *   A FAILED READ IS NOT A REFUSAL — #492's rule, and it matters more here than
 *   on a screen. If processed_payments is unreachable, the existing approval
 *   stands and the failure is logged loudly. Revoking a paid-up member's savings
 *   because a query timed out would be a worse defect than the one being fixed.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the payment requirement dropped again          KILLED  (4 tests)
 *     the legacy exemption removed                   KILLED  (4 tests)
 *     the processed_payments fallback removed        KILLED  (1 test)
 *     reword this header                             SURVIVED, as intended
 *
 *   NOT COVERED, and said rather than implied: the catch around the
 *   processed_payments lookup — the "a failed read is not a refusal" branch —
 *   has no test, because the fake database has no way to make that one query
 *   throw. It is reasoned, not measured. An untested branch that decides
 *   whether somebody reaches their savings is worth naming; the honest state is
 *   that a mutant flipping `paymentSettled = true` to `false` in that catch
 *   would SURVIVE this suite.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import type { UserRole } from '@/lib/types/roles';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

async function access(userId: string, roles: string[], app: string): Promise<boolean> {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    return checkModuleAccess(userId, roles as UserRole[], app as never);
}

const UID = 'user-1';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;

/** A user document carrying nothing that grants access on its own. */
function bareUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, UID, { email: 'member@example.com', ...extra });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#497 — an active membership nobody paid for does not open the module', () => {
    it('THE UNPAID ACTIVE MEMBER IS REFUSED', async () => {
        //   THE test. `membershipStatus: "active"` was the whole condition, and
        //   #496 showed a heal writing it with no payment anywhere.
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'active',
            paymentStatus: 'pending',
        });

        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });

    it('AND SO IS THE APPROVED ONE — both spellings of the status', async () => {
        //   `status === "active" || status === "approved"` was one condition, so
        //   fixing one word would leave the other door open. Two doors, again.
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'approved',
            paymentStatus: 'pending',
        });

        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });

    it('AND THE PAID MEMBER IS UNAFFECTED', async () => {
        //   The vacuity guard. A change that refused everybody would satisfy
        //   both assertions above.
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'active',
            paymentStatus: 'completed',
        });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#497 — and the seventy-four who never owed a fee keep their savings', () => {
    it('A LEGACY MEMBER IS ADMITTED WITHOUT A PAYMENT', async () => {
        //   74 of the 77 active-unpaid members on production are these. They
        //   joined before the platform charged anything. Removing this carve-out
        //   to catch two people would lock out the entire pre-platform
        //   membership.
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'active',
            paymentStatus: 'pending',
            isLegacy: true,
        });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('and the exemption is also read from the user document', async () => {
        //   `legacyOnboardedBy` is the other spelling of the same fact, and
        //   _coop_identity.ts consults both. A carve-out honoured on one of two
        //   fields is the class this finding is about.
        bareUser({ legacyOnboardedBy: 'admin-3' });
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'active',
            paymentStatus: 'pending',
        });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#497 — a stale field does not cost a real payer their module', () => {
    it('THE AUTHORITATIVE FALLBACK IS CONSULTED', async () => {
        //   One of the three non-legacy members on production is exactly this:
        //   active, `paymentStatus` never updated, and a completed payment
        //   sitting in processed_payments. _coop_identity.ts already consults it
        //   and this mirrors it rather than inventing a second rule.
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'active',
            paymentStatus: 'pending',
        });
        store.seed(PAYMENTS, 'pay-1', {
            userId: UID,
            type: 'cooperative_membership_registration',
            status: 'completed',
            amount: 10000,
        });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('and a payment for something else does not count', async () => {
        //   The fallback filters on type and status. A completed ACADEMY payment
        //   is not a cooperative registration fee — #496 found the same
        //   conflation opening the ID card to Academy subscribers.
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'active',
            paymentStatus: 'pending',
        });
        store.seed(PAYMENTS, 'pay-1', {
            userId: UID,
            type: 'academy_subscription',
            status: 'completed',
        });

        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });

    it('and a payment that never completed does not count either', async () => {
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'active',
            paymentStatus: 'pending',
        });
        store.seed(PAYMENTS, 'pay-1', {
            userId: UID,
            type: 'cooperative_membership_registration',
            status: 'abandoned',
        });

        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#497 — the healable path still requires what it always required', () => {
    it('a pending membership that IS paid and onboarded is still healed in', async () => {
        //   Untouched by this finding, and asserted so that "require payment"
        //   cannot quietly become "require an active status too".
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'pending',
            paymentStatus: 'completed',
            onboardingCompleted: true,
        });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
        expect(store.get(MEMBERS, 'mem-1')?.membershipStatus).toBe('active');
    });

    it('and a suspended member is still refused, with no heal', async () => {
        //   The decision guard that a previous finding added here. A payment
        //   requirement must not accidentally re-open the suspension door by
        //   reordering the checks.
        bareUser();
        store.seed(MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'suspended',
            paymentStatus: 'completed',
            onboardingCompleted: true,
        });

        expect(await access(UID, [], 'cooperatives')).toBe(false);
        expect(store.get(MEMBERS, 'mem-1')?.membershipStatus).toBe('suspended');
    });
});
