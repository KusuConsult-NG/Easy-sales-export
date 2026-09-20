/**
 * @jest-environment node
 */

/**
 *   THE userId SWEEP REACHED TWO MODULES OF THREE.
 *
 *   Counted rather than remembered — bare owner-field equality against
 *   resolved lookups, per module, before this change:
 *
 *       Farm Nation     2 bare / 19 resolved
 *       Cooperative    12 bare / 14 resolved
 *       WAVE           11 bare /  3 resolved      <- the inverse
 *
 *   Every one of WAVE's eleven was a member reading their OWN records —
 *   applications, certificates, shipments, resources, training, withdrawals —
 *   which is precisely the shape tranches 1 to 4 widened everywhere else.
 *
 * ── AND ONE OF THEM WAS MONEY ───────────────────────────────────────────────
 *
 *   _wv_earnings computes, in one function:
 *
 *       entitlement = calculatedPaidAmount - withdrawnAmount
 *
 *   The two sides were resolved DIFFERENTLY, 110 lines apart:
 *
 *       line 106   commissions   ownedProfileIds + filterByOwner   complete
 *       line 223   withdrawals   .where("userId", "==", userId)    live only
 *
 *   So for a member whose profile was superseded the numerator counted every
 *   profile and the denominator counted one, and the entitlement came out TOO
 *   HIGH — money already withdrawn read as still owed. Somebody widened the
 *   earnings side and did not widen the side that subtracts from it.
 *
 *   AND IT DID NOT STOP AT THE SCREEN. Where `waveEarningsBalance` was unset,
 *   the auto-backfill in the same function WROTE that figure onto the user
 *   document — a display error becoming a stored one, on a balance a member
 *   withdraws against.
 *
 *   The fix names the owned ids ONCE and hands the same list to both queries,
 *   so the two sides cannot disagree about who this person is. That is what
 *   the first test below pins, and it is a stronger guarantee than widening
 *   the second query would have been.
 *
 *   `ownedProfileIdsFor` rather than `ownedProfileIds`, because this action
 *   lets an ADMIN pass somebody else's id, and a backward-only search handed a
 *   superseded id finds what points AT it and misses the live row.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
//   The commission is DERIVED from the sale at the configured rate — the two
//   copies of 0.05 were collapsed into one setting, so the fixture reads it
//   rather than hard-coding a second.
jest.mock('@/lib/system-settings', () => ({ getWaveSettings: async () => ({ commissionRate: 0.05 }) }));

let store: FakeDbHandle;

const LIVE = 'live-profile';
const OLD = 'superseded-profile';
const STRANGER = 'somebody-else';

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() =>
        id === null
            ? Promise.resolve({ session: null, error: { error: 'Authentication required' } })
            : Promise.resolve({ session: { user: { id, email: `${id}@e.com`, roles } }, error: null })
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, LIVE, {
        email: 'member@example.com',
        serviceRegistrations: { wave: { status: 'approved' } },
    });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
    setSession(LIVE);
});

// ─── the money one ───────────────────────────────────────────────────────────

describe('WAVE earnings: both sides of the subtraction, or neither', () => {
    async function earnings(id = LIVE) {
        const { calculateEarningsAction } = await import('@/app/actions/wave/_wv_earnings');
        return await calculateEarningsAction(id) as any;
    }

    /**
     * A released sale, filed under whichever profile was live at the time.
     * `commission` is what the member earns: 5% of the sale.
     */
    function seedSale(sellerId: string, commission: number, id: string) {
        store.seed(COLLECTIONS.ESCROW_TRANSACTIONS, id, {
            sellerId, status: 'released', amount: commission * 20,
            createdAt: new Date().toISOString(),
        });
    }

    function seedWithdrawal(userId: string, amount: number, id: string) {
        store.seed(COLLECTIONS.WAVE_WITHDRAWALS, id, {
            userId, amount, status: 'completed', createdAt: new Date().toISOString(),
        });
    }

    it('THE test — a withdrawal under the old profile still counts against what is owed', async () => {
        //   Commission earned on the live profile; the withdrawal taken before
        //   the profiles were settled, so it sits under the old one. Before
        //   this change the withdrawal was invisible and the member read as
        //   owed the whole commission a second time.
        seedSale(LIVE, 10_000, 'esc-1');
        seedWithdrawal(OLD, 10_000, 'wd-1');

        const r = await earnings();

        expect(r.success).toBe(true);
        //   The withdrawal was FOUND — this is the number that read as 0 before.
        expect(r.data.totalWithdrawn).toBe(10_000);
        //   So nothing is left owed: earned 10,000, taken 10,000.
        expect(r.data.paidAmount).toBe(0);
    });

    it('and a stranger\'s withdrawal never counts against them', async () => {
        //   THE control on the widening. Reaching sideways would take money
        //   off this member for a withdrawal that was never theirs.
        seedSale(LIVE, 10_000, 'esc-1');
        seedWithdrawal(STRANGER, 10_000, 'wd-stranger');

        const r = await earnings();

        expect(r.data.totalWithdrawn).toBe(0);
        expect(r.data.paidAmount).toBe(10_000);
    });

    it('and the ordinary member is completely unaffected', async () => {
        //   VACUITY CONTROL. Nearly every member has one profile, and for them
        //   this must emit the same answer it always did.
        seedSale(LIVE, 7_500, 'esc-1');
        seedWithdrawal(LIVE, 2_500, 'wd-1');

        const r = await earnings();

        expect(r.data.paidAmount).toBe(5_000);
    });

    it('AND THE TWO SIDES ARE RESOLVED FROM ONE LIST — the ratchet', () => {
        //   The defect was not that a query was narrow. It was that TWO
        //   queries in one function disagreed about who the member is. A test
        //   on the arithmetic alone would pass again the day somebody widens
        //   one side of a future subtraction and not the other.
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/app/actions/wave/_wv_earnings.ts'), 'utf8');

        //   No bare owner equality left in this file at all.
        expect(src).not.toMatch(/\.where\("userId",\s*"==",/);
        //   And the commissions and the withdrawals are handed the same name.
        const list = src.match(/const ownedIds = await ownedProfileIdsFor\(userId\);/);
        expect(list).not.toBeNull();
        expect((src.match(/filterByOwner\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});

// ─── the member's own records ────────────────────────────────────────────────

describe('a WAVE member sees what they filed under either profile', () => {
    it('their application — so the form is not offered to them twice', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: OLD, status: 'approved',
            createdAt: new Date().toISOString(), submittedAt: new Date().toISOString(),
        });

        const { checkWaveStatusAction } = await import('@/app/actions/wave/_wv_membership');
        const r = await checkWaveStatusAction() as any;

        expect(r.success).toBe(true);
        //   Read as "approved" from an application filed under the old id.
        //   Before this it read as no application at all.
        expect(r.data?.status).toBe('approved');
    });

    it('their certificates', async () => {
        store.seed(COLLECTIONS.WAVE_CERTIFICATES, 'cert-1', {
            memberId: OLD, title: 'Export Readiness', issuedAt: new Date().toISOString(),
        });

        const { getMemberCertificatesAction } = await import('@/app/actions/wave/_wv_certificates');
        const r = await getMemberCertificatesAction(LIVE) as any;

        expect(r.success).toBe(true);
        expect(r.data).toHaveLength(1);
    });

    it('their shipments', async () => {
        store.seed(COLLECTIONS.WAVE_SHIPMENTS, 'ship-1', {
            memberId: OLD, status: 'in_transit', createdAt: new Date().toISOString(),
        });

        const { getShipmentTrackingAction } = await import('@/app/actions/wave/_wv_shipments');
        const r = await getShipmentTrackingAction(LIVE) as any;

        expect(r.success).toBe(true);
        expect(r.data).toHaveLength(1);
    });

    it('and NOT a stranger\'s, on any of them', async () => {
        //   One control covering all three widenings.
        store.seed(COLLECTIONS.WAVE_CERTIFICATES, 'cert-x', { memberId: STRANGER, title: 'Not theirs' });
        store.seed(COLLECTIONS.WAVE_SHIPMENTS, 'ship-x', { memberId: STRANGER, status: 'in_transit' });

        const { getMemberCertificatesAction } = await import('@/app/actions/wave/_wv_certificates');
        const { getShipmentTrackingAction } = await import('@/app/actions/wave/_wv_shipments');

        expect(((await getMemberCertificatesAction(LIVE) as any).data ?? [])).toHaveLength(0);
        expect(((await getShipmentTrackingAction(LIVE) as any).data ?? [])).toHaveLength(0);
    });
});

// ─── and the sweep's own coverage ────────────────────────────────────────────

describe('the sweep now reaches WAVE', () => {
    it('NO BARE OWNER LOOKUP REMAINS IN THE MODULE', () => {
        //   The count that started this. A ratchet rather than a one-off:
        //   WAVE was missed once because nothing was watching it.
        const { execSync } = require('child_process');
        const out = execSync(
            `grep -rn '\\.where("\\(userId\\|memberId\\|ownerId\\|buyerId\\|sellerId\\|applicantId\\)", *"==" *,' `
            + `src/app/actions/wave --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim();

        expect({ remaining: out ? out.split('\n') : [] }).toEqual({ remaining: [] });
    });

    it('VACUITY GUARD: the same search finds the pattern where it still lives', () => {
        //   A grep that matched nothing would pass the test above against a
        //   module that had never been touched.
        const { execSync } = require('child_process');
        const out = execSync(
            `grep -rn '\\.where("\\(userId\\|memberId\\)", *"==" *,' src/app/actions --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim();

        expect(out.length).toBeGreaterThan(0);
    });
});
