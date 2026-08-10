/**
 * @jest-environment node
 */

/**
 * processExportInvestment — the one conversion the migration deliberately left.
 *
 * WHY IT WAS LEFT
 * ---------------
 * `docs/audit/atomic-money-migration.md` records this path as "deliberately not
 * converted", and the reason is real rather than an oversight. It writes the
 * processed_payments marker with TWO different statuses — "completed" normally,
 * "overfunded_review" when the investment would exceed the funding goal — and
 * platform_revenue_totals() sums exactly the "completed" rows as revenue.
 *
 * Claiming first means choosing a status before the overfunding branch has run.
 * Claiming as "completed" would have started counting overfunded payments as
 * revenue: a behaviour change smuggled inside an idempotency fix.
 *
 * THE RESOLUTION
 * --------------
 * A two-step write. Claim as "pending_fulfilment" — not revenue — then promote
 * to the real status once the branch resolves.
 *
 * The second race the doc records is closed at the same time: the overfunding
 * guard read fundedAmount, compared `currentFunded + amount > fundingGoal`, and
 * wrote, with no lock, so two investments that each fit under the goal but
 * together exceed it both passed. incrementWithinCeiling (migration 015) locks
 * the row and applies the ceiling in one statement.
 *
 * A crash between claim and promotion strands the row at "pending_fulfilment".
 * That is the safe direction — under-counted, not over-counted — and
 * reconcile-fulfilment now reports those rows explicitly, since the artefact
 * checks only look at "completed" and would otherwise never see them.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaim = jest.fn() as jest.Mock<any>;
const mockCeiling = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaim(...a),
    incrementWithinCeiling: (...a: any[]) => mockCeiling(...a),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(),
    decrementManyOrFail: jest.fn(),
}));

jest.mock('@/lib/whatsapp-invites', () => ({
    generateAndSendWhatsAppInvite: jest.fn(() => Promise.resolve()),
}));

const REF = 'EXP-REF-1';

function setWindow(data: Record<string, any> = {}) {
    const snap = {
        exists: true,
        docs: [],
        empty: false,
        data: () => ({
            fundingGoal: 1_000_000,
            fundedAmount: 900_000,
            roiPercentage: '15-20%',
            returnMultiplier: 1.2,
            ...data,
        }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** Direct .update() calls whose patch contains the named field. */
function updatesWith(field: string) {
    return ((global as any).mockFirestoreUpdate.mock.calls as any[])
        .filter(([, f]) => f && field in f);
}

function touched(name: string) {
    return ((global as any).mockFirestoreCollection.mock.calls as any[])
        .some(([n]) => n === name);
}

async function run() {
    const { processExportInvestment } = await import('@/infrastructure/payments/service');
    return processExportInvestment(REF, 50_000, 'investor-1', 'win-1');
}

describe('processExportInvestment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWindow();
        mockClaim.mockResolvedValue({ claimed: true, status: 'pending_fulfilment' });
        mockCeiling.mockResolvedValue({ ok: true, value: 950_000, reason: null });
    });

    it('claims with a neutral status, never as revenue', async () => {
        // THE test. Claiming as "completed" up front is the behaviour change
        // that kept this path unconverted: it would have counted an overfunded
        // payment as revenue before the overfunding branch had even run.
        await run();

        expect(mockClaim).toHaveBeenCalledTimes(1);
        const [args] = mockClaim.mock.calls[0] as [any];
        expect(args.status).toBe('pending_fulfilment');
        expect(args.status).not.toBe('completed');
        expect(args.reference).toBe(REF);
        expect(args.type).toBe('export_investment');
    });

    it('promotes to completed only after the funding is applied', async () => {
        await run();

        const promotions = updatesWith('status');
        expect(promotions.length).toBeGreaterThan(0);
        expect(promotions.some(([, f]) => f.status === 'completed')).toBe(true);
    });

    it('applies the funding through the bounded primitive', async () => {
        await run();

        expect(mockCeiling).toHaveBeenCalledWith(expect.objectContaining({
            collection: 'exportWindows',
            id: 'win-1',
            field: 'fundedAmount',
            amount: 50_000,
            ceilingField: 'fundingGoal',
        }));
    });

    it('picks the ceiling field from the record, not a hardcoded name', async () => {
        // Windows store the goal under fundingGoal OR goal depending on when
        // they were written. Hardcoding either silently uncaps half of them,
        // because increment_within_ceiling treats a missing ceiling as
        // deliberately unbounded.
        setWindow({ fundingGoal: undefined, goal: 500_000 });

        await run();

        const [args] = mockCeiling.mock.calls[0] as [any];
        expect(args.ceilingField).toBe('goal');
    });

    it('does not double-count fundedAmount in the stats update', async () => {
        // fundedAmount was raised by the ceiling call. The stats update used to
        // increment it again in the same function; leaving both would count the
        // investment twice.
        await run();

        expect(updatesWith('fundedAmount')).toHaveLength(0);
        expect(updatesWith('investorCount').length).toBeGreaterThan(0);
    });

    it('records an overfunded investment out of revenue, and creates no slot', async () => {
        mockCeiling.mockResolvedValue({ ok: false, value: 1_000_000, reason: 'at_capacity' });

        await run();

        const promotions = updatesWith('status');
        expect(promotions.some(([, f]) => f.status === 'overfunded_review')).toBe(true);
        expect(promotions.some(([, f]) => f.status === 'completed')).toBe(false);
        expect(touched('export_slots')).toBe(false);
        expect(touched('failedPayments')).toBe(true);
    });

    it('fulfils nothing when the claim is lost', async () => {
        mockClaim.mockResolvedValue({ claimed: false, status: 'completed' });

        await run();

        expect(mockCeiling).not.toHaveBeenCalled();
        expect(touched('export_slots')).toBe(false);
        expect(updatesWith('status')).toHaveLength(0);
    });
});
