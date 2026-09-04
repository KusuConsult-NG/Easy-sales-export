/**
 * @jest-environment node
 */

/**
 * _confirmDeliveryAction — the seller could be paid twice, by two different
 * routes, out of two different pots.
 *
 * TWO PATHS RELEASE ONE ESCROW
 * ----------------------------
 * `releaseEscrowFunds` (admin, wired to three escrow pages) claims the escrow
 * transition and credits the seller's in-platform WALLET with the escrow amount.
 *
 * `_confirmDeliveryAction` releases the same escrow and sends a real PAYSTACK
 * BANK TRANSFER of 97.5% of the order total, plus WAVE earnings.
 *
 * The admin path claims. This one did not:
 *
 *     const escrowDoc = await escrowRef.get();
 *     if (escrowDoc.exists) {
 *         await escrowRef.update({ status: "released", ... });
 *     }
 *
 * `exists` is not `status`. An escrow the admin had already released passed
 * that check and was released again, and the seller was paid a second time —
 * once into their wallet, once into their bank account.
 *
 * The order-level claim directly above (delivered → completed) does not help.
 * It guards a different row: it stops THIS function running twice, not the
 * admin path having already run.
 *
 * This is the same shape as the vendor writers and the escrow confirm — a guard
 * applied to one copy of a path and not to its sibling.
 *
 * NOTE ON REACHABILITY: `confirmDeliveryAction` currently has no caller, so this
 * is not live today. It is fixed rather than deleted because it is the only code
 * that applies the 2.5% platform commission and credits WAVE earnings on a sale
 * — see the audit note. Wiring it up must not be the moment this is discovered.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ESCROW_RELEASABLE_FROM } from '@/lib/escrow-status';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ORDER_ID = 'ord-1';

const mockClaimStatus = jest.fn() as jest.Mock<any>;
const mockClaimFromAny = jest.fn() as jest.Mock<any>;
const mockPayout = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...a: any[]) => mockClaimStatus(...a),
    claimStatusTransitionFromAny: (...a: any[]) => mockClaimFromAny(...a),
}));
jest.mock('@/lib/paystack-transfer', () => ({
    paystackPayout: (...a: any[]) => mockPayout(...a),
    // The REAL payoutReference. A mock that stubs only paystackPayout leaves
    // this undefined, the caller throws on the call, and the action's own catch
    // turns it into a generic failure — the fourth time an incomplete mock has
    // made a working path look broken in this codebase. Taken from the real
    // module so the reference asserted here is the reference sent (#249).
    payoutReference: (jest.requireActual('@/lib/paystack-transfer') as typeof import('@/lib/paystack-transfer')).payoutReference,
}));
jest.mock('@/lib/logistics', () => ({ getLogisticsProvider: jest.fn() }));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, roles: [] } },
        error: null,
    }));
}

/**
 * The order is delivered and owned by BUYER; the seller is a WAVE member with
 * bank details on file, so both money movements are in play.
 */
function setDocs({
    escrowExists = true,
    // What the escrow row records as owed to THIS seller. 100,000 gross less
    // the 5% the escrow creators actually write (#254). `undefined` models a
    // row written before netAmount existed.
    escrowNetAmount = 95_000 as number | undefined,
}: { escrowExists?: boolean; escrowNetAmount?: number | undefined } = {}) {
    (global as any).mockFirestoreGet.mockImplementation(function (this: any) {
        const path = String((this as any)?.__path ?? '');
        // The order read, the escrow read and the seller read all come through
        // the same stub, so the doc returned covers all three shapes.
        return Promise.resolve({
            exists: path.includes('escrow') ? escrowExists : true,
            empty: false,
            docs: [],
            data: () => ({
                buyerId: BUYER,
                sellerId: SELLER,
                status: 'delivered',
                totalAmount: 100_000,
                roles: ['wave_participant'],
                bankAccountNumber: '0123456789',
                // #208 — the seller's account was confirmed against the bank.
                // Without the stamp paystackPayout refuses the release, which
                // is the point of that finding and not of this one.
                accountNameSource: 'bank_resolve',
                accountResolvedAt: '2026-01-01T00:00:00.000Z',
                bankCode: '058',
                bankAccountName: 'A Seller',
                // Escrow-shaped fields. Only the escrow read uses them.
                ...(escrowNetAmount === undefined
                    ? {}
                    : { netAmount: escrowNetAmount, grossAmount: 100_000, platformFee: 100_000 - escrowNetAmount }),
            }),
        });
    });
}

/**
 * Every WAVE-earnings patch written this test.
 *
 * The update mock records `(docId, patch)` — the patch is the SECOND argument.
 * Reading the first one yields a string, whose Object.keys are character
 * indices, and an assertion over those can never match anything.
 */
function waveCredits(): Record<string, any>[] {
    return (global as any).mockFirestoreUpdate.mock.calls
        .map((call: any[]) => call[1])
        .filter((patch: any) => patch && 'serviceRegistrations.wave.waveEarningsBalance' in patch);
}

async function confirm() {
    const { confirmDeliveryAction } = await import('@/app/actions/order-management');
    return confirmDeliveryAction(ORDER_ID);
}

describe('_confirmDeliveryAction — releasing an escrow the admin already released', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setDocs();
        mockClaimStatus.mockResolvedValue({ claimed: true, status: 'completed' });
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'released' });
        mockPayout.mockResolvedValue({ success: true, transferCode: 'TRF-1' });
    });

    it('claims the escrow release instead of writing it blindly', async () => {
        // THE test. A blind `escrowRef.update({status:"released"})` never
        // consults the current status, so it cannot detect a prior release.
        await confirm();

        expect(mockClaimFromAny).toHaveBeenCalledWith(expect.objectContaining({
            id: `ESC-${ORDER_ID}-${SELLER.substring(0, 5)}`,
            to: 'released',
        }));
    });

    it('accepts release from the same states the admin path accepts', async () => {
        // If the two paths disagree on the valid from-states, one can pay out
        // of a state the other refuses — which is how the divergence started.
        //
        // Compared against the SHARED set rather than a literal list. This test
        // used to hardcode ['delivered','disputed','funded'], which is what it
        // observed at the time; the admin path in _escrow_lifecycle.ts was
        // meanwhile claiming from "funded" ALONE, so "the same states" was never
        // actually true and this assertion could not tell. Asserting against
        // ESCROW_RELEASABLE_FROM makes the two paths provably identical, and
        // widening the set updates both at once instead of failing here.
        await confirm();

        const [args] = mockClaimFromAny.mock.calls[0] as [any];
        expect([...args.fromAny].sort()).toEqual([...ESCROW_RELEASABLE_FROM].sort());
    });

    it('and in_transit is one of them', async () => {
        // Pinned explicitly because it is the value the old literal omitted. An
        // escrow that shipped but whose receipt was never confirmed still has to
        // be releasable.
        await confirm();

        const [args] = mockClaimFromAny.mock.calls[0] as [any];
        expect(args.fromAny).toContain('in_transit');
    });

    it('does NOT pay the seller when the escrow was already released', async () => {
        // The money test. Admin released via releaseEscrowFunds (wallet credit);
        // the buyer then confirms delivery. Without the claim the seller also
        // receives a bank transfer of 97.5% of the order.
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'released' });

        await confirm();

        expect(mockPayout).not.toHaveBeenCalled();
    });

    it('does NOT credit WAVE earnings when the escrow was already released', async () => {
        // The bank transfer is the obvious duplicate; the WAVE ledger credit is
        // the quiet one, and it is a separate write needing its own guard.
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'released' });

        await confirm();

        expect(waveCredits()).toHaveLength(0);
    });

    it('does credit WAVE earnings on a genuine first release', async () => {
        // Vacuity guard for the assertion above, and it is not decorative: the
        // first version of that test read the mock's FIRST argument, which is
        // the document id, not the patch. It passed against the unfixed code,
        // proving nothing. 5% of 100,000.
        await confirm();

        expect(waveCredits()).toHaveLength(1);
        expect(waveCredits()[0]['serviceRegistrations.wave.waveEarningsBalance'])
            .toMatchObject({ _operand: 5_000 });
    });

    it('still pays the seller on a genuine first release', async () => {
        // Vacuity guard: the two refusals above must not be satisfied by a
        // function that has simply stopped paying anyone.
        await confirm();

        expect(mockPayout).toHaveBeenCalledTimes(1);
        // The escrow's own netAmount — 95,000, seeded above — and a reference
        // derived from the order rather than a random one (#249).
        expect(mockPayout).toHaveBeenCalledWith(
            expect.anything(), 95_000, expect.anything(), 'ESCROW-ord-1',
            // #208's fifth argument: the stored seller record whose
            // resolution stamp paystackPayout checks before sending.
            expect.anything());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#254 — the payout figure comes from the escrow, not a literal', () => {
    /**
     *   #254 THE PAYOUT WITHHELD 2.5%. THE ESCROW RECORDED 5%.
     *
     *        Two lines apart from #253's commission literal:
     *
     *            const platformCommissionRate = 0.025;
     *            sellerAmount = Math.floor(
     *                currentOrder.totalAmount * (1 - platformCommissionRate));
     *
     *        Both escrow creators — _payment_orders.ts and _payment_verify.ts —
     *        write `platformFee = grossAmount * fees.platformFeePercentage` and
     *        `netAmount = grossAmount - platformFee`, and that percentage is
     *        0.05. So for a 100,000 order the escrow row says the platform took
     *        5,000 and the seller is owed 95,000 — and this paid them 97,500.
     *        The platform collected half what its own books recorded, on every
     *        release through this path.
     *
     *        AND IT USED THE WRONG BASE. `currentOrder.totalAmount` is the
     *        WHOLE order. The seller is `sellerIds[0]` and the escrow is
     *        per-seller, so on a two-seller order the first seller was paid
     *        97.5% of both sellers' items and the second was paid nothing.
     *
     *        Both go away by paying the figure the escrow already holds:
     *        netAmount is that seller's gross less the fee actually recorded
     *        against them. The rate stops being a number this file owns —
     *        which is what let it drift to 0.025 in the first place.
     */
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setDocs();
        mockClaimStatus.mockResolvedValue({ claimed: true, status: 'completed' });
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'released' });
        mockPayout.mockResolvedValue({ success: true, transferCode: 'TRF-1' });
    });

    it('PAYS THE ESCROW\'S RECORDED netAmount, NOT total × 0.975', async () => {
        // Seeded deliberately as neither 97,500 (the old literal) nor a round
        // percentage of the total, so only a reader of the record can produce it.
        setDocs({ escrowNetAmount: 88_123 });

        await confirm();

        expect(mockPayout).toHaveBeenCalledWith(
            expect.anything(), 88_123, expect.anything(), 'ESCROW-ord-1',
            // #208's fifth argument: the stored seller record whose
            // resolution stamp paystackPayout checks before sending.
            expect.anything());
    });

    it('AND ON A MULTI-SELLER ORDER PAYS ONLY THIS SELLER\'S SHARE', async () => {
        // The escrow row for seller one holds their own gross and net. The
        // order total is 100,000 across two sellers; this seller is owed 38,000.
        // Was: 97,500 — the whole order, less 2.5%.
        setDocs({ escrowNetAmount: 38_000 });

        await confirm();

        const [, amount] = mockPayout.mock.calls[0] as unknown as [unknown, number];
        expect(amount).toBe(38_000);
        expect(amount).not.toBe(97_500);
    });

    it('falls back to the configured fee when the escrow row has no netAmount', async () => {
        // Rows written before netAmount existed. The fallback is the CONFIGURED
        // percentage (5%), not a literal — so the two agree even here.
        setDocs({ escrowNetAmount: undefined });

        await confirm();

        const [, amount] = mockPayout.mock.calls[0] as unknown as [unknown, number];
        expect(amount).toBe(95_000);
    });

    it('refuses a caller who is not the buyer, before consuming any claim', async () => {
        setSession('someone-else');

        const r: any = await confirm();

        expect(r.success).toBe(false);
        expect(mockClaimStatus).not.toHaveBeenCalled();
        expect(mockPayout).not.toHaveBeenCalled();
    });

    it('does not pay when the order transition is lost', async () => {
        // Double-clicking Confirm. The order claim is the first gate.
        mockClaimStatus.mockResolvedValue({ claimed: false, status: 'completed' });

        const r: any = await confirm();

        expect(r.success).toBe(false);
        expect(mockPayout).not.toHaveBeenCalled();
    });
});
