/**
 * @jest-environment node
 */

/**
 * processAcademyRegistration — the Paystack WEBHOOK half of academy
 * fulfilment, EXECUTED.
 *
 * It had only ever been asserted as source text (academy-payment-amount.test.ts,
 * academy-application-plan.test.ts). That is enough to pin a fee table; it is
 * not enough to catch what this file found.
 *
 * WHY THIS HALF MATTERS MORE THAN THE OTHER
 * -----------------------------------------
 * The webhook and the client callback race by design, and the webhook usually
 * wins — Paystack fires it before the user's browser is redirected back. So the
 * webhook is normally the path that actually decides an academy registration.
 * Both must apply the same rules or whichever arrives first sets the outcome,
 * which is exactly how #53 (no amount check on one side) happened.
 *
 *   #227 WHICH APPLICATION IT APPROVED WAS ARBITRARY.
 *        `.where("userId", "==", userId).limit(1)`, no orderBy. The adapter
 *        falls back to `.order('id')`, so for an applicant with more than one
 *        application the row that decided was whatever sorted first — in the
 *        path that GRANTS module access.
 *
 *   #231 AND IT APPROVED OVER A REJECTION.
 *        `status: "approved"`, `reviewedBy: "paystack_auto_approval"`,
 *        `arrayUnion("academy_participant")`, `isVerified: true` —
 *        unconditionally. Paying the fee is what admits a NEW applicant and that
 *        stays. Nothing asked whether an admin had already decided the other
 *        way, so a rejection was reversible for the price of the fee.
 *
 *        The payment is still claimed, still ledgered and still recorded on the
 *        registration. Only the approval does not happen.
 *
 * WHAT IS MOCKED
 * --------------
 * claimPaymentOnce (a Postgres CAS the fake deliberately does not implement),
 * the WhatsApp invite and the cache invalidation — all network. The fee table,
 * the plan normalisation and every decision this handler makes run for real.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
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

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => undefined),
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

let store: FakeDbHandle;

const LEARNER = 'learner-1';
const USERS = COLLECTIONS.USERS;
const APPS = COLLECTIONS.ACADEMY_APPLICATIONS;
const FEES = { foundation: 45_000, standard: 90_000, elite: 270_000 } as const;

const service = async () => await import('@/infrastructure/payments/service');

const fulfil = async (plan: keyof typeof FEES = 'foundation', ref = 'PSK-WH-1') =>
    (await service()).processAcademyRegistration(ref, FEES[plan], LEARNER, plan);

const readUser = () => store.get(USERS, LEARNER) as Record<string, any>;
const reg = () => readUser()?.serviceRegistrations?.academy ?? {};

const seedUser = (academy?: Record<string, unknown>) => {
    store.seed(USERS, LEARNER, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['general_user'],
        ...(academy ? { serviceRegistrations: { academy } } : {}),
    });
};

const seedApp = (id: string, status: string, submittedAt: string) => {
    store.seed(APPS, id, { userId: LEARNER, status, submittedAt, createdAt: submittedAt });
};

beforeEach(() => {
    jest.clearAllMocks();
    claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the ordinary registration still works', () => {
    it('approves the application, grants the role and writes the ledger row', async () => {
        seedUser();
        seedApp('app-1', 'pending', '2026-01-01T00:00:00.000Z');

        await fulfil('elite');

        expect(store.get(APPS, 'app-1')?.status).toBe('approved');
        expect(store.get(APPS, 'app-1')?.reviewedBy).toBe('paystack_auto_approval');
        expect(reg().status).toBe('approved');
        expect(reg().plan).toBe('elite');
        expect(readUser().roles).toContain('academy_participant');
        expect(readUser().isVerified).toBe(true);
        expect(store.get(COLLECTIONS.TRANSACTIONS, 'PSK-WH-1')?.amount).toBe(FEES.elite);
    });

    it('records a payment made before any application exists, without the role', async () => {
        seedUser();

        await fulfil('foundation');

        expect(reg().status).toBe('pending');
        expect(reg().paymentStatus).toBe('completed');
        expect(readUser().roles).not.toContain('academy_participant');
    });

    it('refuses an underpayment by throwing, so the payment stays reconcilable', async () => {
        seedUser();

        await expect(
            (await service()).processAcademyRegistration('PSK-WH-2', 1_000, LEARNER, 'elite'),
        ).rejects.toThrow(/Insufficient payment/i);

        expect(claimPaymentOnce).not.toHaveBeenCalled();
        expect(reg().paymentStatus).toBeUndefined();
    });

    it('does nothing twice — the claim decides', async () => {
        seedUser();
        seedApp('app-1', 'pending', '2026-01-01T00:00:00.000Z');
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        await fulfil();

        expect(store.get(APPS, 'app-1')?.status).toBe('pending');
        expect(readUser().roles).not.toContain('academy_participant');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#231 — the webhook does not approve over a rejection either', () => {
    it.each(['rejected', 'declined', 'revoked', 'suspended', 'cancelled'])(
        'LEAVES A %s APPLICATION AS IT IS', async (status) => {
            seedUser({ status });
            seedApp('app-1', status, '2026-01-01T00:00:00.000Z');

            await fulfil();

            // Was: "approved", attributed to paystack_auto_approval.
            expect(store.get(APPS, 'app-1')?.status).toBe(status);
            expect(store.get(APPS, 'app-1')?.reviewedBy).toBeUndefined();
        });

    it('AND DOES NOT HAND BACK THE ROLE #210 REVOKED', async () => {
        seedUser({ status: 'rejected' });
        seedApp('app-1', 'rejected', '2026-01-01T00:00:00.000Z');

        await fulfil();

        expect(readUser().roles).not.toContain('academy_participant');
        expect(readUser().isVerified).not.toBe(true);
    });

    it('AND DOES NOT SOFTEN THE REJECTION TO "pending" ON THE USER DOCUMENT', async () => {
        // That would be its own reversal: the decision cleared from the user
        // document while it still stands on the application, and Layer 2 of
        // checkModuleAccess reads the user document first.
        seedUser({ status: 'rejected' });
        seedApp('app-1', 'rejected', '2026-01-01T00:00:00.000Z');

        await fulfil();

        expect(reg().status).toBe('rejected');
    });

    it('BUT THE MONEY IS STILL RECORDED, SO IT CAN BE REFUNDED', async () => {
        seedUser({ status: 'rejected' });
        seedApp('app-1', 'rejected', '2026-01-01T00:00:00.000Z');

        await fulfil('standard');

        expect(claimPaymentOnce).toHaveBeenCalled();
        expect(store.get(COLLECTIONS.TRANSACTIONS, 'PSK-WH-1')?.amount).toBe(FEES.standard);
        expect(reg().paymentStatus).toBe('completed');
        expect(reg().paymentReference).toBe('PSK-WH-1');
        expect(reg().plan).toBe('standard');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#227 — and it reads the LATEST application, not an arbitrary one', () => {
    /**
     * The ids run alphabetically AGAINST the chronology on purpose: an unordered
     * query returns rows by id (the adapter's `.order('id')` fallback, which the
     * fake reproduces), so `a-old-*` is exactly the row the defect trusted.
     */
    it('A NEW REJECTION IS NOT OVERRIDDEN BY AN OLD APPROVAL', async () => {
        seedUser({ status: 'rejected' });
        seedApp('a-old-approved', 'approved', '2026-01-01T00:00:00.000Z');
        seedApp('b-new-rejected', 'rejected', '2026-06-01T00:00:00.000Z');

        await fulfil();

        expect(readUser().roles).not.toContain('academy_participant');
        expect(store.get(APPS, 'b-new-rejected')?.status).toBe('rejected');
    });

    it('AND A NEW APPLICATION IS THE ONE APPROVED', async () => {
        seedUser();
        seedApp('a-old-rejected', 'rejected', '2026-01-01T00:00:00.000Z');
        seedApp('b-new-pending', 'pending', '2026-06-01T00:00:00.000Z');

        await fulfil();

        expect(store.get(APPS, 'b-new-pending')?.status).toBe('approved');
        expect(store.get(APPS, 'a-old-rejected')?.status).toBe('rejected');
        expect(readUser().roles).toContain('academy_participant');
    });

    it('the same payment twice gives the same answer', async () => {
        seedUser({ status: 'rejected' });
        seedApp('a-old-approved', 'approved', '2026-01-01T00:00:00.000Z');
        seedApp('b-new-rejected', 'rejected', '2026-06-01T00:00:00.000Z');

        const answers: boolean[] = [];
        for (let i = 0; i < 4; i++) {
            store = installFakeDb();
            seedUser({ status: 'rejected' });
            seedApp('a-old-approved', 'approved', '2026-01-01T00:00:00.000Z');
            seedApp('b-new-rejected', 'rejected', '2026-06-01T00:00:00.000Z');
            await fulfil('foundation', `PSK-WH-${i}`);
            answers.push(Boolean(readUser().roles?.includes('academy_participant')));
        }

        expect(new Set(answers).size).toBe(1);
        expect(answers[0]).toBe(false);
    });
});
