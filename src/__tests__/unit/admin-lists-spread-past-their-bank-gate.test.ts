/**
 * @jest-environment node
 */

/**
 * THE GATE WITHHELD ONE KEY AND THE ROW CARRIED THE SAME VALUES IN ANOTHER.
 *
 * Twelve admin lists compute a `maySeeBankDetails` permission and use it to gate
 * a `bankDetails` key. #338 and #341 established that gating a key is not enough
 * when the same object also spreads a raw document, and lib/admin-pii.ts was
 * written for exactly that — its own header says so:
 *
 *     "several of those lists also spread a raw user or registration document
 *      into the response, where the same values sit nested and survive any
 *      field-by-field gate applied above them. This is the strip for those
 *      spreads."
 *
 * #338 applied it to five sites. FIVE MORE were still spreading past their own
 * gate, and one of them had no gate at all:
 *
 *   cooperative/_coop_admin_money   getAllTransactionsAction
 *                                   `user: canonical` (bankDetails, bvn, nin)
 *                                   and `metadata: raw` (accountNumber,
 *                                   accountName, bankCode) beside a correctly
 *                                   gated bankDetails key.
 *   wave/_wv_admin_withdrawals      getStandardWaveWithdrawalsAction
 *                                   `...w` — the raw row, which
 *                                   admin/_withdrawals.ts strips under a
 *                                   comment naming THIS queue — plus a
 *                                   userMap built with bankDetails
 *                                   unconditionally.
 *   cooperative/_coop_admin_members getAllMembersAction
 *                                   `...m`, the raw member row. The action's
 *                                   own search filter reads m.accountNumber,
 *                                   m.nin and m.bvn off it, so the row
 *                                   demonstrably carries them — and the DETAIL
 *                                   view in the same file already strips.
 *   wave/_wv_admin_applications     getWaveApplicationsAction — `...app`.
 *   wave/_wv_admin_applications     getStandardWaveApplicationsAction —
 *                                   NO BANK GATE AT ALL. Both of its row
 *                                   builders returned user.bankDetails
 *                                   outright, and the application branch also
 *                                   returned `data: { ...app, ...canonical }`,
 *                                   where ...canonical is extractCanonicalUser's
 *                                   output and carries the member's raw nin and
 *                                   bvn.
 *
 * Every one of these lists admits its caller with isAdmin(), true for all TEN
 * admin roles. So a `support` or `moderator` account — which deliberately holds
 * none of finance:process_withdrawals, cooperatives:approve_members or
 * wave:approve_applications — received account numbers, BVNs and NINs.
 *
 * These tests EXECUTE each action twice, once as a role that may act on the
 * records and once as one that may not, and read the returned rows. The
 * assertion is on the serialised row rather than on named keys, because naming
 * the keys is what the original gates did and what the spreads got past.
 *
 * THE TWO BRANCHES ARE #341's RULE, UNCHANGED. A caller who may act sees what
 * they are deciding on minus any credential (stripSecrets); a caller who may
 * not loses the PII with it (stripPii). Each list uses the permission its own
 * file already chose — this narrows access and widens nobody's.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isAdmin, hasAdminPermission } from '@/lib/admin-permissions';

jest.mock('@/lib/redis', () => ({
    redis: null,
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    CACHE_TTL: {},
}));
jest.mock('@/lib/audit-log', () => ({
    ...(jest.requireActual('@/lib/audit-log') as object),
    logAuditAction: jest.fn(async () => undefined),
    createAdminAuditLog: jest.fn(async () => ({})),
    recordAdminAction: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

declare const global: any;

let store: FakeDbHandle;

const ACCOUNT = '0123456789';
const BVN = '22222222222';
const NIN = '11111111111';

/** A role that reaches every one of these lists but may act on none of them. */
const ONLOOKER = ['support'];

function actAs(roles: string[]) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'caller', roles, email: 'caller@example.com' } },
        error: null,
    }));
}

function seedMember() {
    store.seed(COLLECTIONS.USERS, 'm1', {
        email: 'member@example.com', fullName: 'Ada Obi', roles: ['general_user'],
        bvn: BVN, nin: NIN,
        bankDetails: { bankName: 'GTB', accountNumber: ACCOUNT, accountName: 'Ada Obi', bankCode: '058' },
    });
}

/** Everything the row could possibly carry, as one string. */
function serialise(value: unknown): string {
    return JSON.stringify(value ?? null);
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedMember();
});

describe('the roles under test are the ones the finding is about', () => {
    it('a support admin reaches these lists and may act on none of them', () => {
        expect(isAdmin(ONLOOKER)).toBe(true);
        expect(hasAdminPermission(ONLOOKER, 'finance:process_withdrawals')).toBe(false);
        expect(hasAdminPermission(ONLOOKER, 'cooperatives:approve_members')).toBe(false);
        expect(hasAdminPermission(ONLOOKER, 'wave:approve_applications')).toBe(false);
    });

    it('and an admin may act on all three', () => {
        expect(hasAdminPermission(['admin'], 'finance:process_withdrawals')).toBe(true);
        expect(hasAdminPermission(['admin'], 'cooperatives:approve_members')).toBe(true);
        expect(hasAdminPermission(['admin'], 'wave:approve_applications')).toBe(true);
    });
});

describe('the cooperative transactions list', () => {
    async function rows(roles: string[]) {
        store.seed(COLLECTIONS.COOPERATIVE_TRANSACTIONS, 'coopwd_w1', {
            userId: 'm1', cooperativeId: 'default', type: 'withdrawal', amount: 5000,
            status: 'completed', reference: 'coopwd_w1', date: '2026-01-05T00:00:00.000Z',
            bankName: 'GTB', accountNumber: ACCOUNT, accountName: 'Ada Obi', bankCode: '058',
        });
        actAs(roles);
        const { getAllTransactionsAction } =
            await import('@/app/actions/cooperative/_coop_admin_money');
        return ((await getAllTransactionsAction({})) as any)?.data?.transactions ?? [];
    }

    it('CARRIES NO ACCOUNT NUMBER OR IDENTITY NUMBER FOR AN ONLOOKER', async () => {
        // Before the fix this shipped the account number TWICE — at
        // user.bankDetails.accountNumber and at metadata.accountNumber —
        // while correctly omitting the gated top-level bankDetails key.
        const row = (await rows(ONLOOKER))[0];

        expect(row).toBeDefined();
        expect(serialise(row)).not.toContain(ACCOUNT);
        expect(serialise(row)).not.toContain(BVN);
        expect(serialise(row)).not.toContain(NIN);
    });

    it('and still carries them for a caller who processes withdrawals', async () => {
        const row = (await rows(['admin']))[0];

        expect(serialise(row)).toContain(ACCOUNT);
        expect(row.bankDetails.accountNumber).toBe(ACCOUNT);
    });

    it('and the row is still usable — the reason the list exists survives', async () => {
        const row = (await rows(ONLOOKER))[0];

        expect(row).toMatchObject({ userId: 'm1', type: 'withdrawal', amount: 5000 });
        expect(row.userName).toBe('Ada Obi');
    });
});

describe('the WAVE withdrawal queue', () => {
    async function rows(roles: string[]) {
        store.seed(COLLECTIONS.WAVE_WITHDRAWALS, 'w1', {
            userId: 'm1', amount: 7500, status: 'pending',
            requestedAt: '2026-01-05T00:00:00.000Z',
            bankName: 'GTB', bankAccountNumber: ACCOUNT, bankAccountName: 'Ada Obi', bankCode: '058',
        });
        actAs(roles);
        const { getStandardWaveWithdrawalsAction } =
            await import('@/app/actions/wave/_wv_admin_withdrawals');
        const res = (await getStandardWaveWithdrawalsAction({})) as any;
        return res?.data?.withdrawals ?? res?.withdrawals ?? res?.data ?? [];
    }

    it('CARRIES NO ACCOUNT NUMBER FOR AN ONLOOKER', async () => {
        // Two leaks here: the `...w` spread of the raw row — which
        // admin/_withdrawals.ts strips under a comment naming this very queue —
        // and a userMap built with bankDetails unconditionally.
        expect(serialise(await rows(ONLOOKER))).not.toContain(ACCOUNT);
    });

    it('and still carries them for a caller who processes withdrawals', async () => {
        expect(serialise(await rows(['admin']))).toContain(ACCOUNT);
    });
});

describe('the cooperative member list', () => {
    async function rows(roles: string[]) {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1', {
            userId: 'm1', fullName: 'Ada Obi', status: 'active', savingsBalance: 1000,
            bankName: 'GTB', accountNumber: ACCOUNT, nin: NIN, bvn: BVN,
        });
        actAs(roles);
        const { getAllMembersAction } =
            await import('@/app/actions/cooperative/_coop_admin_members');
        const res = (await getAllMembersAction({})) as any;
        return res?.data?.members ?? res?.members ?? [];
    }

    it('CARRIES NO ACCOUNT NUMBER, BVN OR NIN FOR AN ONLOOKER', async () => {
        // The action's own search filter reads m.accountNumber, m.nin and m.bvn
        // off the raw row, which is how we know the row carries them.
        const out = serialise(await rows(ONLOOKER));

        expect(out).not.toContain(ACCOUNT);
        expect(out).not.toContain(BVN);
        expect(out).not.toContain(NIN);
    });

    it('and still carries them for a caller who approves members', async () => {
        expect(serialise(await rows(['admin']))).toContain(ACCOUNT);
    });

    it('and the membership record itself still comes back', async () => {
        const out = await rows(ONLOOKER);

        expect(out[0]).toMatchObject({ userId: 'm1', status: 'active' });
    });
});

describe('the WAVE application lists', () => {
    function seedApplication() {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'a1', {
            userId: 'm1', status: 'pending', fullName: 'Ada Obi',
            createdAt: '2026-01-05T00:00:00.000Z',
            nin: NIN, bvn: BVN, accountNumber: ACCOUNT, bankName: 'GTB',
        });
    }

    async function gatedList(roles: string[]) {
        seedApplication();
        actAs(roles);
        const { getWaveApplicationsAction } =
            await import('@/app/actions/wave/_wv_admin_applications');
        const res = (await getWaveApplicationsAction()) as any;
        return res?.data?.applications ?? [];
    }

    async function standardList(roles: string[]) {
        seedApplication();
        actAs(roles);
        const { getStandardWaveApplicationsAction } =
            await import('@/app/actions/wave/_wv_admin_applications');
        const res = (await getStandardWaveApplicationsAction({})) as any;
        return res?.data?.forms ?? res?.forms ?? res?.data ?? [];
    }

    it('the gated list CARRIES NO IDENTITY NUMBERS FOR AN ONLOOKER', async () => {
        const out = serialise(await gatedList(ONLOOKER));

        expect(out).not.toContain(BVN);
        expect(out).not.toContain(NIN);
        expect(out).not.toContain(ACCOUNT);
    });

    it('THE STANDARD LIST HAD NO BANK GATE AT ALL, AND NOW DOES', async () => {
        // The worst of the five: no maySeeBankDetails anywhere in the action,
        // user.bankDetails returned outright, and `data: {...app, ...canonical}`
        // injecting the member's raw nin and bvn.
        const out = serialise(await standardList(ONLOOKER));

        expect(out).not.toContain(BVN);
        expect(out).not.toContain(NIN);
        expect(out).not.toContain(ACCOUNT);
    });

    it('and both still carry them for a caller who approves applications', async () => {
        expect(serialise(await gatedList(['admin']))).toContain(BVN);
        expect(serialise(await standardList(['admin']))).toContain(BVN);
    });

    /**
     * The standard list has a SECOND row builder, taken when the caller asks
     * for status "approved": that tab lists everyone holding the
     * `wave_participant` role, synthesising a row for the majority who have no
     * application document behind them. It emitted user.bankDetails and the
     * synthesised `data` object with the same freedom, and it is reached by a
     * different query, so it needs its own seed to be covered at all — the
     * application-shaped tests above leave it untouched.
     */
    describe('and its role-only tab, which is a different row builder', () => {
        async function memberTab(roles: string[]) {
            store.seed(COLLECTIONS.USERS, 'm1', {
                email: 'member@example.com', fullName: 'Ada Obi',
                roles: ['general_user', 'wave_participant'],
                createdAt: '2026-01-01T00:00:00.000Z',
                bvn: BVN, nin: NIN,
                bankDetails: {
                    bankName: 'GTB', accountNumber: ACCOUNT, accountName: 'Ada Obi', bankCode: '058',
                },
            });
            actAs(roles);
            const { getStandardWaveApplicationsAction } =
                await import('@/app/actions/wave/_wv_admin_applications');
            const res = (await getStandardWaveApplicationsAction({ status: 'approved' })) as any;
            return res?.data?.forms ?? res?.forms ?? res?.data ?? [];
        }

        it('CARRIES NO ACCOUNT NUMBER, BVN OR NIN FOR AN ONLOOKER', async () => {
            const out = serialise(await memberTab(ONLOOKER));

            // Vacuity guard: the tab must actually have produced the member.
            expect(out).toContain('Ada Obi');
            expect(out).not.toContain(ACCOUNT);
            expect(out).not.toContain(BVN);
            expect(out).not.toContain(NIN);
        });

        it('and still carries them for a caller who approves applications', async () => {
            expect(serialise(await memberTab(['admin']))).toContain(ACCOUNT);
        });
    });

    it('and the standard list still returns the applicant it is a list of', async () => {
        const out = await standardList(ONLOOKER);

        expect(serialise(out)).toContain('m1');
        expect(serialise(out)).toContain('Ada Obi');
    });
});
