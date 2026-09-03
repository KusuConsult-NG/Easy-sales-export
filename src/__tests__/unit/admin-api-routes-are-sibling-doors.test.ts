/**
 * @jest-environment node
 */

/**
 *   #339 FOUR ADMIN API ROUTES WERE THE UNHARDENED SIBLINGS OF SERVER ACTIONS
 *        THAT HAD ALREADY BEEN GATED.
 *
 *        #338 was found by hand, so the follow-up was a scan: which responses
 *        spread a raw document to the client? Every candidate under
 *        src/app/actions turned out to be gated already. Every one that was
 *        NOT was an HTTP route under src/app/api/admin — reading the same
 *        collections, spreading the same documents, still on isAdmin(), which
 *        is true for all TEN admin roles.
 *
 *          /api/admin/marketplace/withdrawals
 *              WALLET_TRANSACTIONS withdrawal rows. wallet.ts writes
 *              `bankDetails` onto the transaction at request time and this
 *              route spread the whole document. TWO other readers of the same
 *              rows already require "finance:process_withdrawals": the action
 *              the admin screen actually calls (wallet.ts
 *              getAdminWalletWithdrawalsAction) and admin/_withdrawals.ts.
 *              This was the third door.
 *
 *          /api/admin/farm-nation/land-verifications
 *              LAND_LISTINGS, spread whole — the owner's email and phone and
 *              the URLs of their C of O, survey plan and tax clearance. #148
 *              closed exactly this on _fna_verifications.ts.
 *
 *          /api/admin/marketplace/seller-verifications
 *              SELLER_VERIFICATIONS, spread whole — submit-verification writes
 *              `documents` (business certificate, ID card, proof of address)
 *              and TWO copies of the bank block into it. #154 closed this on
 *              admin/_marketplace.ts with lib/admin-pii's stripPii.
 *
 *          /api/admin/cooperative/loan-applications
 *              LOAN_APPLICATIONS, spread whole — the borrower's name and email
 *              and their GUARANTOR's name, phone, email and relationship. The
 *              guarantor is a third party who never signed up for anything
 *              here. admin/_loans.ts refuses the same list without
 *              "cooperatives:approve_loans".
 *
 *        NONE of the four is called by any screen. That is why the earlier
 *        fixes did not reach them — and it is not a reason to leave them open:
 *        an HTTP GET is reachable with a session cookie whether or not a
 *        component in the bundle calls it. Gated, not removed.
 *
 *        Each route takes the gate its sibling over the same collection takes,
 *        by the same mechanism: three refuse outright, the seller queue keeps
 *        the list open and strips the pack, because that is what
 *        admin/_marketplace.ts does and for the reason it gives — a support
 *        agent answering "did my verification go through" needs the status.
 *
 *        BEHAVIOURAL, NOT A GREP. A guard that is present and reached around
 *        greps the same as one that works — /api/admin/broadcast/estimate was
 *        exactly that. These call the real handlers.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { COLLECTIONS } from '@/lib/types/firestore';

declare const global: any;

// ─── fixtures: what each collection actually holds ───────────────────────────

const ACCOUNT_NUMBER = '0123456789';
const ID_DOC_URL = 'https://res.cloudinary.com/demo/idcard.jpg';
const C_OF_O_URL = 'https://res.cloudinary.com/demo/certificate-of-occupancy.pdf';
const GUARANTOR_PHONE = '08099999999';

const stamp = (iso: string) => ({ toDate: () => new Date(iso) });

const SELLER_VERIFICATION = {
    userId: 'u1',
    businessName: 'Acme Produce',
    status: 'pending',
    // Both written by api/marketplace/submit-verification.
    bankDetails: { bankName: 'GTB', accountNumber: ACCOUNT_NUMBER, accountName: 'A Seller' },
    bankAccount: { bankName: 'GTB', accountNumber: ACCOUNT_NUMBER, accountName: 'A Seller' },
    documents: { idDoc: ID_DOC_URL, businessDoc: 'x', addressProof: 'y' },
    createdAt: stamp('2026-01-01T00:00:00.000Z'),
};

const WITHDRAWAL = {
    userId: 'u1',
    type: 'withdrawal',
    status: 'pending',
    amount: -5000,
    bankDetails: { bankName: 'GTB', accountNumber: ACCOUNT_NUMBER, accountName: 'A Seller' },
    createdAt: stamp('2026-01-01T00:00:00.000Z'),
};

const LAND_LISTING = {
    ownerId: 'u1',
    ownerEmail: 'owner@example.com',
    ownerPhone: '08011111111',
    status: 'pending_verification',
    documents: { landTitle: C_OF_O_URL, surveyPlan: '', taxClearance: '' },
    createdAt: stamp('2026-01-01T00:00:00.000Z'),
};

const LOAN_APPLICATION = {
    userId: 'u1',
    loanProduct: 'cooperative',
    amount: 100_000,
    status: 'pending',
    guarantorName: 'G Person',
    guarantorPhone: GUARANTOR_PHONE,
    guarantorEmail: 'g@example.com',
    guarantorRelationship: 'Brother',
    appliedAt: stamp('2026-01-01T00:00:00.000Z'),
};

const ROWS: Record<string, any[]> = {
    [COLLECTIONS.SELLER_VERIFICATIONS]: [{ id: 'v1', data: () => SELLER_VERIFICATION }],
    [COLLECTIONS.WALLET_TRANSACTIONS]: [{ id: 'w1', data: () => WITHDRAWAL }],
    [COLLECTIONS.LAND_LISTINGS]: [{ id: 'l1', data: () => LAND_LISTING }],
    [COLLECTIONS.LOAN_APPLICATIONS]: [{ id: 'a1', data: () => LOAN_APPLICATION }],
};

const USER_DOC = {
    exists: true,
    data: () => ({ firstName: 'A', lastName: 'Seller', email: 'seller@example.com' }),
};

// A chainable query stub. Every filter returns itself; get() hands back the
// rows for the collection the chain started from, so the routes' own mapping
// code runs for real.
function makeDb() {
    const query = (name: string): any => ({
        where: () => query(name),
        orderBy: () => query(name),
        limit: () => query(name),
        startAfter: () => query(name),
        count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
        get: async () => {
            const docs = ROWS[name] ?? [];
            return { docs, empty: docs.length === 0, forEach: (f: any) => docs.forEach(f), truncated: false };
        },
        doc: () => ({ get: async () => USER_DOC }),
    });
    return { collection: (name: string) => query(name), runTransaction: jest.fn() };
}

jest.mock('@/lib/supabase-db', () => {
    const db = makeDb();
    return { supabaseDb: db, getAdminDb: () => db };
});
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

// ─── the callers ─────────────────────────────────────────────────────────────

const asRoles = (roles: string[]) => ({
    session: { user: { id: 'admin1', roles, email: 'a@x.com' } },
    error: null,
});

/** A real admin role. isAdmin() is true for it; it holds none of the four permissions. */
const SUPPORT = asRoles(['support']);
/** Holds all four. */
const SUPER_ADMIN = asRoles(['super_admin']);

const REQUEST = { url: 'https://x.test/api?status=pending' } as any;

async function get(mod: string, session: any, req: any = REQUEST) {
    global.mockRequireSession.mockResolvedValueOnce(session);
    const { GET } = await import(mod);
    return (GET as any)(req);
}

const WITHDRAWALS = '@/app/api/admin/marketplace/withdrawals/route';
const LAND = '@/app/api/admin/farm-nation/land-verifications/route';
const SELLERS = '@/app/api/admin/marketplace/seller-verifications/route';
const LOANS = '@/app/api/admin/cooperative/loan-applications/route';

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#339 — three queues refuse an admin who cannot act on them', () => {
    it('THE WITHDRAWAL QUEUE: support gets 403, and no account number', async () => {
        // THE test. finance:process_withdrawals is super_admin and admin only.
        const res = await get(WITHDRAWALS, SUPPORT);
        expect(res.status).toBe(403);
        expect(JSON.stringify(await res.json())).not.toContain(ACCOUNT_NUMBER);
    });

    it('THE LAND QUEUE: support gets 403, and no certificate of occupancy', async () => {
        const res = await get(LAND, SUPPORT);
        expect(res.status).toBe(403);
        expect(JSON.stringify(await res.json())).not.toContain(C_OF_O_URL);
    });

    it("THE LOAN QUEUE: support gets 403, and no guarantor's phone number", async () => {
        const res = await get(LOANS, SUPPORT);
        expect(res.status).toBe(403);
        expect(JSON.stringify(await res.json())).not.toContain(GUARANTOR_PHONE);
    });

    it('an unauthenticated caller is still refused first', async () => {
        for (const mod of [WITHDRAWALS, LAND, LOANS, SELLERS]) {
            const res = await get(mod, { session: null, error: { error: 'expired' } });
            expect(res.status).toBe(401);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#339 — and still answer the admin who can', () => {
    it('the withdrawal queue returns the row, bank details included', async () => {
        const res = await get(WITHDRAWALS, SUPER_ADMIN);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.withdrawals).toHaveLength(1);
        expect(body.withdrawals[0].bankDetails.accountNumber).toBe(ACCOUNT_NUMBER);
    });

    it('the land queue returns the listing, deeds included', async () => {
        const res = await get(LAND, SUPER_ADMIN);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.verifications).toHaveLength(1);
        expect(JSON.stringify(body)).toContain(C_OF_O_URL);
    });

    it('the loan queue returns the application, guarantor included', async () => {
        const res = await get(LOANS, SUPER_ADMIN);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.applications).toHaveLength(1);
        expect(body.applications[0].guarantorPhone).toBe(GUARANTOR_PHONE);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#339 — the seller queue stays open and loses the pack', () => {
    it('SUPPORT STILL GETS THE LIST — this is a strip, not a lockout', async () => {
        // The counterpart guard. admin/_marketplace.ts keeps the list open for
        // exactly this case; a fix that returned 403 here would be a different
        // decision from the one the sibling already made.
        const res = await get(SELLERS, SUPPORT);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.verifications).toHaveLength(1);
        expect(body.verifications[0].businessName).toBe('Acme Produce');
        expect(body.verifications[0].status).toBe('pending');
    });

    it('AND LOSES THE ACCOUNT NUMBER, BOTH COPIES OF IT, AND THE ID CARD', async () => {
        const res = await get(SELLERS, SUPPORT);
        const row = (await res.json()).verifications[0];

        expect(row.bankDetails).toBeUndefined();
        expect(row.bankAccount).toBeUndefined();
        expect(row.documents).toBeUndefined();
        expect(JSON.stringify(row)).not.toContain(ACCOUNT_NUMBER);
        expect(JSON.stringify(row)).not.toContain(ID_DOC_URL);
    });

    it('a marketplace_admin, who approves these, sees the pack', async () => {
        const res = await get(SELLERS, asRoles(['marketplace_admin']));
        const row = (await res.json()).verifications[0];

        expect(row.bankDetails.accountNumber).toBe(ACCOUNT_NUMBER);
        expect(row.documents.idDoc).toBe(ID_DOC_URL);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#339 — the permissions chosen are the ones the siblings use', () => {
    it('VACUITY GUARD: support really is an admin role, so isAdmin let it through', async () => {
        const { isAdmin, hasAdminPermission } = await import('@/lib/admin-permissions');

        expect(isAdmin(['support'])).toBe(true);
        for (const permission of [
            'finance:process_withdrawals',
            'land:verify_listings',
            'cooperatives:approve_loans',
            'marketplace:approve_sellers',
        ] as const) {
            expect(hasAdminPermission(['support'], permission)).toBe(false);
        }
    });

    it('and each gate names the permission its module already required to act', async () => {
        const { readFileSync } = await import('fs');
        const { stripComments } = await import('@/lib/testing/strip-comments');
        const src = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

        const expected: Array<[string, string]> = [
            ['src/app/api/admin/marketplace/withdrawals/route.ts', 'finance:process_withdrawals'],
            ['src/app/api/admin/farm-nation/land-verifications/route.ts', 'land:verify_listings'],
            ['src/app/api/admin/cooperative/loan-applications/route.ts', 'cooperatives:approve_loans'],
            ['src/app/api/admin/marketplace/seller-verifications/route.ts', 'marketplace:approve_sellers'],
        ];

        for (const [file, permission] of expected) {
            expect(src(file)).toContain(`hasAdminPermission(session.user.roles, "${permission}")`);
        }
    });

    it('POSITIVE CONTROL: the siblings that were already gated still are', async () => {
        const { readFileSync } = await import('fs');
        const { stripComments } = await import('@/lib/testing/strip-comments');
        const src = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

        expect(src('src/app/actions/wallet.ts'))
            .toContain('hasAdminPermission(sessionResult.session.user.roles, "finance:process_withdrawals")');
        expect(src('src/app/actions/farm-nation-admin/_fna_verifications.ts'))
            .toContain('hasAdminPermission(session.user.roles, "land:verify_listings")');
        expect(src('src/app/actions/admin/_loans.ts'))
            .toContain('hasAdminPermission(session.user.roles, "cooperatives:approve_loans")');
        expect(src('src/app/actions/admin/_marketplace.ts')).toContain('stripPii(canonical)');
    });

    it('and no admin API route is left spreading a raw document behind isAdmin alone', async () => {
        // The ratchet. If a new route lands with `...doc.data()` in its
        // response and only isAdmin() above it, this fails.
        const { readFileSync, readdirSync, statSync } = await import('fs');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const routes: string[] = [];
        (function walk(dir: string) {
            for (const entry of readdirSync(dir)) {
                const full = `${dir}/${entry}`;
                if (statSync(full).isDirectory()) walk(full);
                else if (entry === 'route.ts') routes.push(full);
            }
        })('src/app/api/admin');

        expect(routes.length).toBeGreaterThan(20);   // vacuity guard on the walk

        const offenders = routes.filter((file) => {
            const code = stripComments(readFileSync(file, 'utf-8'));
            const spreadsRaw = /\.\.\.(data|doc\.data\(\)|d\.data\(\))\b/.test(code);
            const onlyIsAdmin = code.includes('isAdmin(session.user.roles)')
                && !code.includes('hasAdminPermission(');
            return spreadsRaw && onlyIsAdmin;
        });

        expect(offenders).toEqual([]);
    });
});
