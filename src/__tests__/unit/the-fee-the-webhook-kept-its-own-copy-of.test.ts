/**
 * @jest-environment node
 */

/**
 *   #807 THREE PATHS CHARGE THE COOPERATIVE REGISTRATION FEE. THE ONE PAYSTACK
 *        CALLS DECIDED WITH A LITERAL, AND LET AN UNREADABLE AMOUNT THROUGH.
 *
 *        There is ONE cooperative fee: ₦10,000, flat. There is no second band
 *        — `tier2` is a retired ₦20,000 model and nothing prices off it.
 *
 *          api/cooperatives/register        COOPERATIVE_CONFIG.registrationFee
 *          api/cooperative/verify-payment   COOPERATIVE_CONFIG.registrationFee
 *          payments/service.ts (webhook)    const expectedAmount = 10000;
 *
 *        register/route.ts removed its own copy and said why: "Two
 *        registration paths charging from two sources means changing the fee
 *        moves one of them, and the one left behind keeps charging the old
 *        price with nothing to say so." The webhook was never brought in, and
 *        it fails TOWARDS THE MEMBER: lower the fee to ₦5,000 and the member
 *        is charged ₦5,000, Paystack confirms it, and the webhook compares it
 *        to a literal 10,000 and throws. Paid, and never made a member.
 *
 *   AND THE HALF THAT IS WORSE THAN THE DRIFT
 *
 *        The check was `if (amount < expectedAmount - 1)`. The webhook route
 *        builds that figure as `data.amount / 100` with NO guard on the
 *        charge.success path, so an absent amount arrives as NaN — and
 *        `NaN < 9999` is FALSE. The comparison passes. A membership is granted
 *        on a payment whose amount could not be read.
 *
 *        Both sibling handlers in the same file already refuse that:
 *        checkAcademyPayment and checkOrderPaymentAmount each open with
 *        `!Number.isFinite(paid)`. Cooperative was the one payment type still
 *        deciding with a bare comparison against a literal.
 *
 * ── WHAT IS ASSERTED, AND WHERE ─────────────────────────────────────────────
 *
 *   The rule is exercised directly, because that is where the logic is.
 *
 *   THE COUPLING TO THE CONSTANT IS EXECUTED, not grepped: the constants
 *   module is re-mocked with a different fee and the verdict has to follow it.
 *   A literal cannot follow, so that block is what makes "reads the constant"
 *   a measurement rather than a claim about spelling.
 *
 *   Then the WEBHOOK is run, because "an unreadable amount does not buy a
 *   membership" is a claim about the webhook and not about a helper it might
 *   or might not call.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
    checkCooperativeRegistrationPayment,
    COOPERATIVE_FEE_TOLERANCE,
} from '@/lib/cooperative-limits';
import { COOPERATIVE_CONFIG } from '@/lib/constants';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const claimPaymentOnce = jest.fn(async (_p: unknown) => ({ claimed: true } as { claimed: boolean }));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: unknown) => claimPaymentOnce(p),
    incrementWithinCeiling: jest.fn(async () => ({ ok: true })),
    markFulfilmentFailed: jest.fn(async () => undefined),
    CLAIM_TYPE: {},
}));

jest.mock('@/lib/whatsapp-invites', () => ({
    generateAndSendWhatsAppInvite: jest.fn(async () => undefined),
}));

//   The whole module, per #692 — a partial mock returns undefined for every
//   export it omits, and the failure then has nothing to do with this suite.
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => undefined),
    invalidateSellerCache: jest.fn(async () => undefined),
    invalidateCooperativeCache: jest.fn(async () => undefined),
    invalidateServiceCache: jest.fn(async () => undefined),
    invalidateAdminGlobalStats: jest.fn(async () => undefined),
    invalidateMultipleUsers: jest.fn(async () => undefined),
    invalidateSystemSettingsCache: jest.fn(async () => undefined),
    deleteCache: jest.fn(async () => undefined),
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const FEE = COOPERATIVE_CONFIG.registrationFee;

// ─────────────────────────────────────────────────────────────────────────────
describe('#807 — the rule', () => {
    it('THE FLAT FEE IS ENOUGH, and there is only the one', () => {
        const v = checkCooperativeRegistrationPayment(FEE);

        expect(v.ok).toBe(true);
        expect(v.ok && v.fee).toBe(FEE);
        expect(v.ok && v.overpaidBy).toBe(0);
    });

    it('AN UNREADABLE AMOUNT IS REFUSED — the defect, facing the way it failed', () => {
        //   `data.amount / 100` with data.amount absent. The old comparison
        //   `NaN < 9999` is FALSE, so this used to be a membership.
        for (const bad of [NaN, undefined, null, 'not-a-number', {}]) {
            const v = checkCooperativeRegistrationPayment(bad);
            expect(v.ok).toBe(false);
            expect(!v.ok && v.reason).toBe('unreadable_amount');
        }
    });

    it('AND SO IS NOTHING AT ALL', () => {
        for (const bad of [0, -1, -10_000]) {
            const v = checkCooperativeRegistrationPayment(bad);
            expect(v.ok).toBe(false);
            expect(!v.ok && v.reason).toBe('unreadable_amount');
        }
    });

    it('UNDERPAYMENT IS REFUSED, and says by how much', () => {
        const v = checkCooperativeRegistrationPayment(FEE - 2_500);

        expect(v.ok).toBe(false);
        expect(!v.ok && v.reason).toBe('underpaid');
        expect(!v.ok && v.reason === 'underpaid' && v.shortfall).toBe(2_500);
    });

    it('OVERPAYMENT IS ACCEPTED and reported, never refused', () => {
        //   Refusing leaves a member who HAS been charged with no membership
        //   and an error — the outcome this codebase treats as the worst one.
        const v = checkCooperativeRegistrationPayment(FEE + 5_000);

        expect(v.ok).toBe(true);
        expect(v.ok && v.overpaidBy).toBe(5_000);
    });

    it('and the one-naira slack is allowed in both directions', () => {
        expect(checkCooperativeRegistrationPayment(FEE - COOPERATIVE_FEE_TOLERANCE).ok).toBe(true);
        const over = checkCooperativeRegistrationPayment(FEE + COOPERATIVE_FEE_TOLERANCE);
        expect(over.ok).toBe(true);
        // Inside the slack is not "overpaid" — it is rounding.
        expect(over.ok && over.overpaidBy).toBe(0);
    });

    it('POSITIVE CONTROL: a naira below the slack really is refused', () => {
        // Without this, "the slack is allowed" could be measuring a rule that
        // allows everything.
        const v = checkCooperativeRegistrationPayment(FEE - COOPERATIVE_FEE_TOLERANCE - 1);
        expect(v.ok).toBe(false);
    });

    it('a numeric string is read, because a webhook payload is JSON', () => {
        expect(checkCooperativeRegistrationPayment(String(FEE)).ok).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#807 — the fee is READ from the constant, not baked into the rule', () => {
    /**
     * The block that makes the headline claim measurable.
     *
     * A literal cannot follow a constant that moves. So the constants module is
     * replaced with a different fee and the rule is re-imported: if the fee is
     * read, ₦5,000 is now enough and ₦10,000 is an overpayment; if it is baked,
     * neither moves.
     */
    const withFee = async (registrationFee: number) => {
        jest.resetModules();
        jest.doMock('@/lib/constants', () => ({
            COOPERATIVE_CONFIG: { registrationFee },
        }));
        const mod = await import('@/lib/cooperative-limits');
        return mod.checkCooperativeRegistrationPayment;
    };

    afterEach(() => {
        jest.dontMock('@/lib/constants');
        jest.resetModules();
    });

    it('A LOWER FEE IS HONOURED — the member charged ₦5,000 is fulfilled', async () => {
        //   This is the drift, in the direction it actually costs somebody:
        //   against a literal 10,000 this payment threw and the membership was
        //   never written.
        const check = await withFee(5_000);

        const v = check(5_000);
        expect(v.ok).toBe(true);
        expect(v.ok && v.fee).toBe(5_000);
    });

    it('AND THE OLD PRICE BECOMES AN OVERPAYMENT rather than the standard', async () => {
        const check = await withFee(5_000);

        const v = check(10_000);
        expect(v.ok).toBe(true);
        expect(v.ok && v.overpaidBy).toBe(5_000);
    });

    it('AND A HIGHER FEE REFUSES WHAT USED TO BE ENOUGH', async () => {
        const check = await withFee(20_000);

        const v = check(10_000);
        expect(v.ok).toBe(false);
        expect(!v.ok && v.reason).toBe('underpaid');
        expect(!v.ok && v.reason === 'underpaid' && v.fee).toBe(20_000);
    });

    it('POSITIVE CONTROL: the real constant is ₦10,000 flat', () => {
        // So the three tests above are measuring a fee that moved, and not a
        // mock that never took effect.
        expect(COOPERATIVE_CONFIG.registrationFee).toBe(10_000);
        expect(checkCooperativeRegistrationPayment(10_000).ok).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#807 — and the webhook itself, which is the claim', () => {
    let store: FakeDbHandle;
    const MEMBER = 'member-807';
    const USERS = COLLECTIONS.USERS;
    const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;

    const service = async () => await import('@/infrastructure/payments/service');

    const fulfil = async (amount: unknown, ref = 'PSK-COOP-807') =>
        (await service()).processCooperativeRegistration(
            ref, amount as number, MEMBER, 'Member',
        );

    const readMember = () => store.get(MEMBERS, MEMBER) as Record<string, any>;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
        store = installFakeDb();

        store.seed(USERS, MEMBER, {
            email: 'ada@example.com', roles: ['general_user'],
            serviceRegistrations: { cooperatives: { status: 'pending' } },
        });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, membershipStatus: 'pending',
            paymentStatus: 'pending', onboardingCompleted: true,
            createdAt: '2026-01-01T00:00:00.000Z',
        });
    });

    it('AN UNREADABLE AMOUNT BUYS NOTHING', async () => {
        await expect(fulfil(NaN)).rejects.toThrow('Insufficient payment amount');

        // The row is exactly as it was. Before this fix it was "active".
        expect(readMember().membershipStatus).toBe('pending');
        expect(readMember().paymentStatus).toBe('pending');
    });

    it('AND NOTHING IS CLAIMED FOR IT EITHER', async () => {
        //   A claim on a payment that was refused would make the reference
        //   un-reprocessable once the real amount is known.
        await expect(fulfil(NaN)).rejects.toThrow();

        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('AN UNDERPAYMENT IS STILL REFUSED, as it always was', async () => {
        await expect(fulfil(1_000)).rejects.toThrow('Insufficient payment amount');
        expect(readMember().membershipStatus).toBe('pending');
    });

    it('POSITIVE CONTROL: THE CORRECT FEE STILL FULFILS', async () => {
        //   The direction that must not move. A handler that refused
        //   everything would pass every assertion above.
        await expect(fulfil(FEE)).resolves.not.toThrow();

        expect(claimPaymentOnce).toHaveBeenCalled();
        expect(readMember().paymentStatus).toBe('completed');
    });

    it('and an overpayment fulfils too rather than stranding the member', async () => {
        await expect(fulfil(FEE + 2_000)).resolves.not.toThrow();

        expect(readMember().paymentStatus).toBe('completed');
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Each mutant applied to src/lib/cooperative-limits.ts or
 *   src/infrastructure/payments/service.ts alone, then this suite re-run
 *   alongside cooperative-registration-payment-guard (which drives the same
 *   handler on the paths this one does not).
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   restore `const expectedAmount = 10000`      2   "AN UNREADABLE AMOUNT BUYS
 *   and the bare comparison — the defect            NOTHING"
 *
 *   drop the `!Number.isFinite(paid)` arm       3   "AN UNREADABLE AMOUNT IS
 *                                                   REFUSED"
 *
 *   read a literal 10000 in the rule rather     3   "A LOWER FEE IS HONOURED"
 *   than COOPERATIVE_CONFIG.registrationFee
 *
 *   `paid <= 0` → `paid < 0` (zero accepted)    2   "AN UNREADABLE AMOUNT IS
 *                                                   REFUSED"
 *
 *   refuse overpayment as well                  3   "OVERPAYMENT IS ACCEPTED
 *                                                   and reported, never refused"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the header comment in the rule       0   SURVIVED ✓
 *
 *   THE THIRD IS THE ONE THAT EARNS THE RE-MOCKED CONSTANTS BLOCK. "The fee is
 *   read from COOPERATIVE_CONFIG" is not observable while the constant and the
 *   literal are the same number — every other test in this file passes with the
 *   literal restored. It dies only against a fee that MOVED.
 */
