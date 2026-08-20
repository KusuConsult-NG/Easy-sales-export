/**
 * @jest-environment node
 */

/**
 * The four lists the #151 scan found, EXECUTED — one call per admin role.
 *
 * bank-details-gates-sweep.test.ts is a grep: it proves each file names a
 * permission, which is what makes it a standing guard against a NEW list
 * appearing with the old shape. It cannot prove the permission is actually
 * consulted on the path that builds the row. This suite calls the actions.
 *
 *   #152 getUsersAction — the platform-wide admin user directory — returned
 *        every member's BVN, NIN, next of kin, bank account number, account
 *        name and bank code under "users:read", which ALL TEN admin roles hold.
 *        The CSV of the same fields is gated on "users:export" (super_admin and
 *        admin) by #64, and admin-permissions.ts explains why in its own
 *        comment. So the export was locked and the table beside it was not —
 *        and with `search` set the table's fetch limit rises to 5,000 rows, so
 *        the gated download was reachable by paging the ungated screen.
 *
 *   #153 getStandardAcademyApplicationsAction — isAdmin(), two mappers, each
 *        attaching the learner's bank details.
 *
 *   #154 getStandardSellerVerificationsAction and getMarketplaceUsersAction —
 *        isAdmin(), returning bank details and, for the first, the URLs of the
 *        seller's ID card and business certificate.
 *
 *   #155 getPendingWithdrawalsAction — "finance:read", held by five roles,
 *        returning the destination account for every withdrawal across the
 *        standard, cooperative AND wave queues at once. Paying one requires
 *        "finance:process_withdrawals": super_admin and admin. The WAVE queue
 *        (#149) and the wallet queue (#92) were closed on that permission; this
 *        action reads all three collections, so it was the widest of the three.
 *
 * Each fix keeps the LIST open to whoever could see it before and removes only
 * the money and identity fields, except where the whole screen exists to do the
 * gated thing. Nobody loses a screen; super_admin and admin lose nothing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { stripPii } from '@/lib/admin-pii';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

let store: FakeDbHandle;

const MEMBER = 'member-1';
const USERS = COLLECTIONS.USERS;

/** Roles that hold none of the four permissions under test. */
const OUTSIDERS = ['moderator', 'support', 'wave_admin', 'export_admin'] as const;

const BANK = {
    bankName: 'GTBank', accountNumber: '0123456789',
    accountName: 'Ada Obi', bankCode: '058',
};

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(USERS, MEMBER, {
        name: 'Ada Obi', email: 'ada@example.com', phone: '08030000000',
        roles: ['general_user', 'marketplace_buyer'],
        bankDetails: BANK,
        bvn: '22222222222',
        nin: '11111111111',
        nextOfKin: { name: 'Ngozi Obi', phone: '08099999999', relationship: 'Sister' },
        kyc: { status: 'verified', bvnVerified: true, ninVerified: true },
        serviceRegistrations: {
            marketplace: {
                status: 'approved',
                verificationProfile: {
                    bvn: '22222222222', bankDetails: BANK,
                    documents: { idCard: 'https://files/id.pdf', businessCert: 'https://files/cac.pdf' },
                },
            },
        },
        createdAt: '2026-05-01T00:00:00.000Z',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('stripPii', () => {
    it('removes money and identity keys at every depth, and leaves the rest', () => {
        const out = stripPii({
            status: 'approved',
            profile: { name: 'Ada', bvn: '2222', bankDetails: BANK },
            history: [{ amount: 500, accountNumber: '0123456789' }],
        }) as any;

        expect(out.status).toBe('approved');
        expect(out.profile.name).toBe('Ada');
        expect(out.profile.bvn).toBeUndefined();
        expect(out.profile.bankDetails).toBeUndefined();
        expect(out.history[0].amount).toBe(500);
        expect(out.history[0].accountNumber).toBeUndefined();
    });

    it('does not mangle a Date or a primitive', () => {
        const d = new Date('2026-05-01T00:00:00.000Z');
        expect(stripPii(d)).toBe(d);
        expect(stripPii('x')).toBe('x');
        expect(stripPii(null)).toBe(null);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#152 — the admin user directory', () => {
    const users = async (options: Record<string, unknown> = {}) =>
        (await (await import('@/app/actions/admin/_users'))
            .getUsersAction(options as never)) as any;

    const rowOf = (res: any) =>
        (res.data?.users ?? res.data)?.find((u: any) => u.id === MEMBER);

    it('refuses a caller with no session, and an ordinary user', async () => {
        actAs(null);
        expect(await users()).toMatchObject({ success: false });

        actAs(MEMBER);
        expect(await users()).toMatchObject({ success: false });
    });

    it.each([...OUTSIDERS, 'marketplace_admin', 'cooperative_admin', 'farm_nation_admin', 'academy_admin'])(
        'GIVES %s THE DIRECTORY WITHOUT THE BANK ACCOUNT, BVN, NIN OR NEXT OF KIN', async (role) => {
            actAs('other-admin', [role]);

            const res = await users();
            expect(res.success).toBe(true);

            const row = rowOf(res);
            expect(row.name).toBe('Ada Obi');       // still usable for a support ticket
            expect(row.email).toBe('ada@example.com');
            expect(row.kycStatus).toBe('verified'); // WHETHER they passed KYC, not the numbers
            expect(row.bvnVerified).toBe(true);

            expect(row.bankDetails).toBeUndefined();
            expect(row.bvn).toBeUndefined();
            expect(row.nin).toBeUndefined();
            expect(row.nextOfKin).toBeUndefined();
        });

    it('DOES NOT LEAVE THE SAME VALUES NESTED IN serviceRegistrations', async () => {
        // The map is passed through whole so the UI can render module badges,
        // and each module keeps its own verificationProfile — with the member's
        // BVN and bank account inside it. Gating the flat fields and spreading
        // the map beside them would have changed nothing.
        actAs('other-admin', ['support']);

        const row = rowOf(await users());
        expect(row.serviceRegistrations.marketplace.status).toBe('approved');
        expect(row.serviceRegistrations.marketplace.verificationProfile).toBeUndefined();
    });

    it.each(['super_admin', 'admin'])('gives %s everything — they hold users:export', async (role) => {
        actAs('finance-admin', [role]);

        const row = rowOf(await users());
        expect(row.bankDetails).toMatchObject({ accountNumber: '0123456789' });
        expect(row.bvn).toBe('22222222222');
        expect(row.nin).toBe('11111111111');
        expect(row.nextOfKin).toMatchObject({ name: 'Ngozi Obi' });
        expect(row.serviceRegistrations.marketplace.verificationProfile).toBeDefined();
    });

    it('the search path is gated too — it is the one that raises the limit to 5,000', async () => {
        actAs('other-admin', ['support']);

        const res = await users({ search: 'ada' });
        expect(res.success).toBe(true);
        for (const row of (res.data?.users ?? res.data ?? [])) {
            expect(row.bankDetails).toBeUndefined();
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#153 — the academy application queue', () => {
    const applications = async (options: Record<string, unknown> = {}) =>
        (await (await import('@/app/actions/academy/_ac_admin_applications'))
            .getStandardAcademyApplicationsAction(options as never)) as any;

    const rows = (res: any): any[] => res.data?.applications ?? res.data ?? [];

    beforeEach(() => {
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            id: 'app-1', userId: MEMBER, status: 'pending',
            personalInfo: { fullName: 'Ada Obi', email: 'ada@example.com' },
            submittedAt: '2026-05-01T00:00:00.000Z',
            createdAt: '2026-05-01T00:00:00.000Z',
        });
    });

    it('refuses a caller with no session, and an ordinary user', async () => {
        actAs(null);
        expect(await applications()).toMatchObject({ success: false });

        actAs(MEMBER);
        expect(await applications()).toMatchObject({ success: false });
    });

    it.each(OUTSIDERS)('GIVES %s THE QUEUE BUT NOT THE BANK DETAILS', async (role) => {
        actAs('other-admin', [role]);

        const res = await applications();
        expect(res.success).toBe(true);

        const row = rows(res)[0];
        expect(row.user.email).toBe('ada@example.com');
        expect(row.user.bankDetails).toBeUndefined();
    });

    it.each(['super_admin', 'admin', 'academy_admin'])(
        'gives %s the bank details — the roles that decide an application', async (role) => {
            actAs('academy-1', [role]);

            const row = rows(await applications())[0];
            expect(row.user.bankDetails).toMatchObject({ accountNumber: '0123456789' });
        });

    it('the in-memory path is gated too', async () => {
        // Two mappers build these rows: one for the indexed query, one for the
        // search/date/registry path. Both attached bank details, so gating one
        // would have left the other open.
        actAs('other-admin', ['support']);

        const res = await applications({ search: 'ada' });
        expect(res.success).toBe(true);
        for (const row of rows(res)) expect(row.user.bankDetails).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#154 — the marketplace admin lists', () => {
    const verifications = async () =>
        (await (await import('@/app/actions/admin/_marketplace'))
            .getStandardSellerVerificationsAction('all' as never)) as any;

    const mpUsers = async (options: Record<string, unknown> = {}) =>
        (await (await import('@/app/actions/admin/_marketplace'))
            .getMarketplaceUsersAction(options as never)) as any;

    const rows = (res: any): any[] =>
        res.data?.forms ?? res.data?.users ?? res.data ?? [];

    beforeEach(() => {
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'sv-1', {
            id: 'sv-1', userId: MEMBER, status: 'pending',
            fullName: 'Ada Obi', email: 'ada@example.com',
            bvn: '22222222222',
            bankDetails: BANK,
            // The shape the two writers actually produce: documents at the root
            // of the application, under the keys the canonical resolver reads.
            documents: { idCard: 'https://files/id.pdf', businessCertificate: 'https://files/cac.pdf' },
            verificationProfile: { status: 'pending', bankDetails: BANK },
            createdAt: '2026-05-01T00:00:00.000Z',
        });
    });

    it.each(OUTSIDERS)('GIVES %s THE VERIFICATION QUEUE WITHOUT THE ACCOUNT OR THE DOCUMENTS', async (role) => {
        actAs('other-admin', [role]);

        const res = await verifications();
        expect(res.success).toBe(true);

        const row = rows(res)[0];
        expect(row.user.email).toBe('ada@example.com');
        expect(row.status).toBe('pending');

        expect(row.user.bankDetails).toBeUndefined();
        expect(row.user.documents).toBeUndefined();
        // `data` is the raw application spread, so it carries the same values
        // under whatever keys the two writers used.
        expect(row.data.bankDetails).toBeUndefined();
        expect(row.data.bvn).toBeUndefined();
        expect(JSON.stringify(row)).not.toContain('0123456789');
        expect(JSON.stringify(row)).not.toContain('id.pdf');
    });

    it.each(['super_admin', 'admin', 'marketplace_admin'])(
        'gives %s the account and the documents — the roles that approve a seller', async (role) => {
            actAs('mp-1', [role]);

            const row = rows(await verifications())[0];
            expect(row.user.bankDetails).toMatchObject({ accountNumber: '0123456789' });
            expect(row.user.documents).toMatchObject({ idCard: 'https://files/id.pdf' });
        });

    it.each(OUTSIDERS)('GIVES %s THE MARKETPLACE USER LIST WITHOUT BANK DETAILS', async (role) => {
        actAs('other-admin', [role]);

        const res = await mpUsers();
        expect(res.success).toBe(true);

        const row = rows(res).find((u: any) => u.id === MEMBER);
        expect(row.email).toBe('ada@example.com');
        expect(row.bankDetails).toBeUndefined();
    });

    it('gives admin the marketplace user list WITH bank details', async () => {
        actAs('mp-1', ['marketplace_admin']);

        const row = rows(await mpUsers()).find((u: any) => u.id === MEMBER);
        expect(row.bankDetails).toMatchObject({ accountNumber: '0123456789' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#155 — the combined withdrawal queue', () => {
    const pending = async () =>
        (await (await import('@/app/actions/admin/_withdrawals'))
            .getPendingWithdrawalsAction(50 as never, undefined as never, 'pending' as never)) as any;

    const rows = (res: any): any[] => res.data?.withdrawals ?? res.data ?? [];

    beforeEach(() => {
        store.seed(COLLECTIONS.WITHDRAWALS, 'w-1', {
            id: 'w-1', userId: MEMBER, amount: 25_000, status: 'pending',
            // The cooperative and wave queues write the destination flat onto
            // the withdrawal row as well as hydrating it from the user.
            bankAccountNumber: '0123456789', bankAccountName: 'Ada Obi', bankCode: '058',
            createdAt: '2026-05-01T00:00:00.000Z',
        });
    });

    it('refuses a caller without finance:read at all', async () => {
        actAs('other-admin', ['academy_admin']);
        expect(await pending()).toMatchObject({ success: false });
    });

    it.each(['support', 'cooperative_admin', 'marketplace_admin'])(
        'GIVES %s THE AMOUNTS AND STATUSES BUT NOT THE DESTINATION ACCOUNT', async (role) => {
            // These three hold finance:read and not finance:process_withdrawals:
            // they reconcile totals, they do not pay anybody.
            actAs('finance-reader', [role]);

            const res = await pending();
            expect(res.success).toBe(true);

            const row = rows(res)[0];
            expect(row.amount).toBe(25_000);
            expect(row.status).toBe('pending');
            expect(row.user.name).toBe('Ada Obi');

            expect(row.bankDetails).toBeUndefined();
            expect(row.user.bankDetails).toBeUndefined();
            // Flat on the row as well as hydrated — both had to go.
            expect(row.bankAccountNumber).toBeUndefined();
            expect(JSON.stringify(row)).not.toContain('0123456789');
        });

    it.each(['super_admin', 'admin'])(
        'gives %s the destination — the roles that process a payout', async (role) => {
            actAs('finance-admin', [role]);

            const row = rows(await pending())[0];
            expect(row.bankDetails).toMatchObject({ accountNumber: '0123456789' });
        });

    // ── #156 ────────────────────────────────────────────────────────────────
    it('FINDS THE ACCOUNT OF A MEMBER WHOSE BANK BLOCK IS THE CANONICAL ONE', async () => {
        // The fixture above is exactly that member: `bankDetails` on the user
        // document and no bankAccountNumber, which is all that
        // marketplace/_mp_onboarding.ts and export/_ex_onboarding.ts write. The
        // hand-written hydration here read the two legacy spellings only, so
        // this queue showed an admin a blank account to pay into.
        actAs('finance-admin', ['admin']);

        const row = rows(await pending())[0];
        expect(row.bankDetails.accountNumber).toBe('0123456789');
        expect(row.bankDetails.bankCode).toBe('058');
    });

    it('and of a member whose account is only in the LEGACY spelling', async () => {
        store.seed(USERS, 'legacy-1', {
            name: 'Emeka Nwosu', email: 'emeka@example.com',
            bankAccountNumber: '9876543210', bankAccountName: 'Emeka Nwosu', bankCode: '011',
        });
        store.seed(COLLECTIONS.WITHDRAWALS, 'w-2', {
            id: 'w-2', userId: 'legacy-1', amount: 5_000, status: 'pending',
            createdAt: '2026-05-02T00:00:00.000Z',
        });
        actAs('finance-admin', ['admin']);

        const row = rows(await pending()).find((r: any) => r.id === 'w-2');
        expect(row.bankDetails.accountNumber).toBe('9876543210');
    });

    it('falls back to the account on the REQUEST when the user document has none', async () => {
        // `a || b` could not reach this: the hydrated block is an object of
        // empty strings, which is truthy.
        store.seed(USERS, 'bare-1', { name: 'Ngozi Obi', email: 'ngozi@example.com' });
        store.seed(COLLECTIONS.WITHDRAWALS, 'w-3', {
            id: 'w-3', userId: 'bare-1', amount: 7_500, status: 'pending',
            bankDetails: { bankName: 'Zenith', accountNumber: '5555555555', accountName: 'Ngozi Obi', bankCode: '057' },
            createdAt: '2026-05-03T00:00:00.000Z',
        });
        actAs('finance-admin', ['admin']);

        const row = rows(await pending()).find((r: any) => r.id === 'w-3');
        expect(row.bankDetails.accountNumber).toBe('5555555555');
    });
});
