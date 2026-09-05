/**
 * @jest-environment node
 */

/**
 *   #421 EVERY ESCROW RELEASE AND REFUND WROTE A ROW SAYING AN ADMIN STILL HAD
 *   TO PAY SOMEBODY. THE MONEY HAD ALREADY MOVED.
 *
 *   Found by a collection-lifecycle sweep — create / read / update / delete
 *   counted per collection across all of src. It is the generalisation of what
 *   actually gave #419 away ("five files touch it, none updates it"). Of 116
 *   collections it flagged 37; NO-UPDATE was almost entirely legitimate
 *   append-only logs, and of the NO-READER hits two were artefacts
 *   (IMPERSONATION_TOKENS was already retired as #396; BOUNCED_EMAILS is read
 *   through getAll(...refs), which the scan cannot see). This one was real.
 *
 *   paymentInstructions: TWO WRITERS, ZERO READERS. The escrow release path and
 *   the escrow refund path each write a row, and nothing in the codebase reads
 *   the collection. Both wrote status "pending_admin_action" — on the statement
 *   after credit_wallet_once had already put the money in the recipient's
 *   wallet, with a wallet_transactions history row keyed on the escrow so a
 *   retry cannot double it.
 *
 *   WHY A COLLECTION NOBODY READS IS WORTH FIXING. Because of the day somebody
 *   builds the queue the field name invites. "Show me the pending_admin_action
 *   rows" returns every escrow release and refund the platform has ever made,
 *   each labelled an unpaid disbursement, and working that queue pays every
 *   seller and every refunded buyer a second time. #249-#251's class — a payout
 *   that can run twice — sitting in the data waiting for a screen.
 *
 *   NOTHING IS DELETED. The rows are genuine records of disbursements and they
 *   stay. What changes is that they say what happened: settled_automatically,
 *   settledVia wallet_credit, and the credit_wallet_once reference that proves
 *   it. Legacy rows still carry the old value and were equally already paid;
 *   with no live database there is no backfill, so isPaymentInstructionOutstanding
 *   carries the rule in code and answers FALSE for both.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     release writes "pending_admin_action" again        KILLED
 *     refund writes "pending_admin_action" again         KILLED
 *     the release drops settledVia                       KILLED
 *     isPaymentInstructionOutstanding returns true       KILLED
 *     ...returns true for the legacy value only          KILLED
 *     the settled reference stops naming the escrow      KILLED
 *     reword the header prose                            SURVIVED, as intended
 *
 *   AND THE INSTRUMENT NEEDED AUDITING FIRST. The initial run reported the
 *   CONTROL killed, which is impossible for a prose edit. The harness was
 *   writing its whole-file backups next to the source as `<file>.snap`, and
 *   jest counts a stray .snap as an OBSOLETE SNAPSHOT and exits non-zero with
 *   every test passing. So the harness read "all 13 passed" as a failure, and
 *   would have reported every mutant killed by nothing. Backups moved outside
 *   the tree; every verdict above is from the re-run.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    PAYMENT_INSTRUCTION_STATUSES,
    PAYMENT_INSTRUCTION_SETTLED,
    PAYMENT_INSTRUCTION_SETTLED_VIA,
    isPaymentInstructionOutstanding,
} from '@/lib/payment-instruction';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/africastalking', () => ({
    smsEscrowReleased: jest.fn(async () => undefined),
    smsDisputeResolved: jest.fn(async () => undefined),
}));
jest.mock('@/lib/fcm', () => ({
    pushEscrowReleased: jest.fn(async () => undefined),
    pushDisputeResolved: jest.fn(async () => undefined),
}));

let store: FakeDbHandle;

const claimFromAny = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    if (!p.fromAny.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, { ...current, ...(p.patch ?? {}), status: p.to });
    return { claimed: true, status: p.to };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: 'x' })),
    claimStatusTransitionFromAny: (p: unknown) => claimFromAny(p),
}));

const creditWalletOnce = jest.fn(
    async (_p: unknown) => ({ claimed: true, balance: 0 } as { claimed: boolean; balance: number }));
jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: (p: unknown) => creditWalletOnce(p),
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    markFulfilmentFailed: jest.fn(async () => undefined),
    debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
}));

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ESCROW = 'ESC-1';
const ORDER = 'ORD-1';
const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;

function actAs(id: string, roles: string[] = ['admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    creditWalletOnce.mockImplementation(async () => ({ claimed: true, balance: 47_500 }));
    store = installFakeDb();
    actAs('admin-1', ['admin']);
    store.seed(ESCROWS, ESCROW, {
        id: ESCROW, orderId: ORDER, buyerId: BUYER, sellerId: SELLER,
        sellerEmail: 'bola@example.com', buyerEmail: 'ada@example.com',
        productName: 'Cocoa',
        amount: 50_000, grossAmount: 50_000, platformFee: 2_500, netAmount: 47_500,
        status: 'funded',
    });
});

const escrowActions = () => import('@/app/actions/marketplace/_escrow_actions');
const release = async () => (await (await escrowActions()).releaseEscrowFunds(ESCROW)) as any;
const refund = async () => (await (await escrowActions()).refundEscrowToBuyer(ESCROW)) as any;

/** The single instruction row a path wrote. */
const instruction = () => {
    const rows = store.all(COLLECTIONS.PAYMENT_INSTRUCTIONS);
    expect(rows.length).toBe(1);
    return rows[0][1] as Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#421 — the instruction records a disbursement, it does not request one', () => {
    it('THE RELEASE ROW SAYS THE MONEY ALREADY SETTLED', async () => {
        expect((await release()).success).toBe(true);

        expect(instruction()).toMatchObject({
            type: 'escrow_release',
            recipientId: SELLER,
            amount: 47_500,
            status: 'settled_automatically',
            settledVia: 'wallet_credit',
        });
    });

    it('and so does the REFUND row', async () => {
        expect((await refund()).success).toBe(true);

        expect(instruction()).toMatchObject({
            type: 'escrow_refund',
            recipientId: BUYER,
            amount: 50_000,
            status: 'settled_automatically',
            settledVia: 'wallet_credit',
        });
    });

    it('and NEITHER row asks an admin to pay anybody', async () => {
        await release();
        expect(instruction().status).not.toBe('pending_admin_action');

        store = installFakeDb();
        store.seed(ESCROWS, ESCROW, {
            id: ESCROW, orderId: ORDER, buyerId: BUYER, sellerId: SELLER,
            buyerEmail: 'ada@example.com', productName: 'Cocoa',
            amount: 50_000, status: 'funded',
        });
        await refund();
        expect(instruction().status).not.toBe('pending_admin_action');
    });

    it('and each names the credit_wallet_once reference that proves it', async () => {
        // Not decoration: it is the join back to processed_payments, which is
        // the row that makes the payment un-repeatable (#249-#251).
        await release();
        expect(instruction().settledReference).toBe(`escrow-release:${ESCROW}`);
        expect(creditWalletOnce.mock.calls.map(([p]) => (p as any).reference))
            .toContain(`escrow-release:${ESCROW}`);
    });

    it('and the refund names its own', async () => {
        await refund();
        expect(instruction().settledReference).toBe(`escrow-refund:${ESCROW}`);
        expect(creditWalletOnce.mock.calls.map(([p]) => (p as any).reference))
            .toContain(`escrow-refund:${ESCROW}`);
    });

    it('and the money really did move BEFORE the row was written — the premise', async () => {
        // If it had not, "settled" would be the lie instead.
        await release();
        expect(creditWalletOnce).toHaveBeenCalledTimes(1);
        expect(creditWalletOnce.mock.calls[0][0]).toMatchObject({
            userId: SELLER, amount: 47_500, status: 'disbursement',
        });
    });

    it('and the rows are still WRITTEN — a record is not deleted here', async () => {
        await release();
        expect(store.all(COLLECTIONS.PAYMENT_INSTRUCTIONS).length).toBe(1);
        expect(instruction()).toMatchObject({ escrowId: ESCROW, createdBy: 'admin-1' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#421 — nothing outstanding, including the legacy rows', () => {
    it('BOTH STORED STATUSES MEAN THE RECIPIENT HAS THE MONEY', () => {
        for (const status of PAYMENT_INSTRUCTION_STATUSES) {
            expect({ status, outstanding: isPaymentInstructionOutstanding(status) })
                .toEqual({ status, outstanding: false });
        }
        expect([...PAYMENT_INSTRUCTION_STATUSES]).toEqual(
            expect.arrayContaining(['settled_automatically', 'pending_admin_action']));
    });

    it('and the legacy value specifically — the rows already in the database', () => {
        // Every row written before this change carries it, and every one of
        // them was paid the same way. There is no backfill, so the rule lives
        // here rather than in the data.
        expect(isPaymentInstructionOutstanding('pending_admin_action')).toBe(false);
    });

    it('and an unreadable status is not outstanding either', () => {
        for (const bad of [undefined, null, '', 'anything']) {
            expect({ bad, outstanding: isPaymentInstructionOutstanding(bad) })
                .toEqual({ bad, outstanding: false });
        }
    });

    it('and the constants the writers use are the ones declared here', () => {
        expect(PAYMENT_INSTRUCTION_SETTLED).toBe('settled_automatically');
        expect(PAYMENT_INSTRUCTION_SETTLED_VIA).toBe('wallet_credit');
        expect([...PAYMENT_INSTRUCTION_STATUSES]).toContain(PAYMENT_INSTRUCTION_SETTLED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#421 — and the writers ask the shared module rather than typing a string', () => {
    const ROOT = process.cwd();
    const ESCROW_FILE = 'src/app/actions/marketplace/_escrow_actions.ts';
    const src = () => stripComments(
        readFileSync(join(ROOT, ESCROW_FILE), 'utf-8'),
        { label: relative(ROOT, ESCROW_FILE) });

    it('THE ESCROW PATHS WRITE THE CONSTANT, NOT A LITERAL', () => {
        const code = src();
        expect(code).toMatch(/status: PAYMENT_INSTRUCTION_SETTLED/);
        expect([...code.matchAll(/status: PAYMENT_INSTRUCTION_SETTLED,/g)].length).toBe(2);
        expect(code).not.toMatch(/status: "pending_admin_action"/);
    });

    it('and it imports them from the module that carries the rule', () => {
        expect(src()).toMatch(/from "@\/lib\/payment-instruction"/);
    });
});
