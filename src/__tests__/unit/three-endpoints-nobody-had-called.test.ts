/**
 * @jest-environment node
 */

/**
 * Three HTTP entry points off the unreached list.
 *
 *   API routes are the part of this application the internet can reach
 *   directly, and #436's whole finding was that they had been outside the
 *   coverage denominator entirely — 121 route files, 87 of them at 0%. Ten
 *   were still named by no test at all. These are the first three.
 *
 * ── WHAT THE AUDIT FOUND, AND WHAT IT DID NOT ───────────────────────────────
 *
 *   NOT a money defect. /api/wallet/verify takes a reference from the query
 *   string with NO SESSION CHECK, which reads alarming and is not: the action
 *   behind it verifies the reference against Paystack with the secret key,
 *   credits `metadata.userId` — the person who started the funding, never the
 *   caller — and goes through creditWalletOnce, which claims the reference so a
 *   second delivery cannot credit twice. An attacker replaying somebody else's
 *   reference completes that person's funding, once. Recorded here so the next
 *   reader does not have to re-derive it.
 *
 *   IT WAS HANDING OUT THE INSIDE OF THE SERVER. The catch did
 *
 *       encodeURIComponent(err.message || "Internal error")
 *
 *   and put it in the redirect the browser then renders. The two messages on
 *   the paths above it are the action's own, written for a member to read; this
 *   one is whatever threw — a database error, a fetch failure — reflected out
 *   of an endpoint anyone can reach without signing in. Encoding stops it being
 *   script. It does not stop it being a description of the server.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const confirmWalletFunding = jest.fn() as jest.Mock<any>;
jest.mock('@/app/actions/wallet', () => ({
    confirmWalletFundingAction: (...args: any[]) => confirmWalletFunding(...args),
}));

const readFixedSavingsPlans = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/cooperative-readers', () => ({
    readFixedSavingsPlans: (...args: any[]) => readFixedSavingsPlans(...args),
}));

const ORIGIN = 'https://easysalesexport.test';
const get = (path: string) => ({ nextUrl: new URL(ORIGIN + path) } as any);

let store: FakeDbHandle;

function actAs(id: string | null) {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles: ['general_user'], email: `${id}@example.test` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('user-1');
});

/** The `error=` parameter of whatever the handler redirected to. */
const redirectedError = (res: any): string | null =>
    new URL(res.headers.get('location')).searchParams.get('error');

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/wallet/verify', () => {
    const route = async () => (await import('@/app/api/wallet/verify/route')).GET;

    it('A SUCCESSFUL VERIFICATION SENDS THE MEMBER TO THEIR WALLET', async () => {
        confirmWalletFunding.mockResolvedValue({ success: true, data: { newBalance: 5000 } });

        const res: any = await (await route())(get('/api/wallet/verify?reference=PS-1'));

        expect(confirmWalletFunding).toHaveBeenCalledWith('PS-1');
        expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard/wallet?status=success`);
    });

    it('AND PAYSTACK\'S OTHER SPELLING OF THE PARAMETER WORKS TOO', () => {
        //   It passes the reference as `reference` or `ref` depending on the
        //   flow. Reading one would silently drop half the returns.
        return route().then(async (GET) => {
            confirmWalletFunding.mockResolvedValue({ success: true, data: {} });
            const res: any = await GET(get('/api/wallet/verify?ref=PS-2'));
            expect(confirmWalletFunding).toHaveBeenCalledWith('PS-2');
            expect(res.headers.get('location')).toContain('status=success');
        });
    });

    it('AND NO REFERENCE AT ALL IS REFUSED WITHOUT CALLING THE ACTION', async () => {
        const res: any = await (await route())(get('/api/wallet/verify'));

        expect(confirmWalletFunding).not.toHaveBeenCalled();
        expect(redirectedError(res)).toBe('Missing reference');
    });

    it('A REFUSAL SHOWS THE ACTION\'S OWN MESSAGE, which is written for a member', async () => {
        confirmWalletFunding.mockResolvedValue({ success: false, error: 'Payment amount mismatch' });

        const res: any = await (await route())(get('/api/wallet/verify?reference=PS-3'));

        expect(redirectedError(res)).toBe('Payment amount mismatch');
    });

    it('BUT A THROW DOES NOT PUT THE SERVER\'S OWN WORDS IN THE URL', async () => {
        /*
         *   THE fix. This endpoint needs no session, so the message went to
         *   whoever asked. `encodeURIComponent` makes it safe to render; it
         *   does not make it safe to disclose.
         */
        confirmWalletFunding.mockRejectedValue(
            new Error('relation "wallet_transactions" does not exist at character 42'),
        );

        const res: any = await (await route())(get('/api/wallet/verify?reference=PS-4'));
        const shown = redirectedError(res) ?? '';

        expect(shown).not.toContain('relation');
        expect(shown).not.toContain('character 42');
        expect(shown).toMatch(/could not confirm that payment/i);
        //   And it still lands the member somewhere they can act.
        expect(res.headers.get('location')).toContain('/dashboard/wallet?status=failed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/marketplace/seller-status', () => {
    const route = async () => (await import('@/app/api/marketplace/seller-status/route')).GET;

    it('AN ANONYMOUS CALLER IS REFUSED', async () => {
        actAs(null);

        const res: any = await (await route())(get('/api/marketplace/seller-status'));

        expect(res.status).toBe(401);
    });

    it('A SELLER WITH NO RECORD IS NOT VERIFIED — not an error', async () => {
        //   Somebody who has never applied is a normal case, and answering 500
        //   or an empty body would make the onboarding screen look broken.
        const res: any = await (await route())(get('/api/marketplace/seller-status'));

        expect(await res.json()).toMatchObject({ success: true, status: 'not_verified' });
    });

    it('AND THE STATUS COMES FROM THE ROW', async () => {
        store.seed(COLLECTIONS.MARKETPLACE_SELLERS, 'user-1', {
            verificationStatus: 'approved', businessName: 'Ada Farms',
        });

        expect(await (await (await route())(get('/api/marketplace/seller-status'))).json())
            .toMatchObject({ success: true, status: 'approved' });
    });

    it('AND A ROW WITH NO STATUS READS AS PENDING, never as approved', () => {
        //   The direction matters: the fallback on a seller gate must not be
        //   the value that opens it.
        store.seed(COLLECTIONS.MARKETPLACE_SELLERS, 'user-1', { businessName: 'Ada Farms' });

        return route()
            .then((GET) => GET(get('/api/marketplace/seller-status')))
            .then((res: any) => res.json())
            .then((body: any) => expect(body.status).toBe('pending'));
    });

    it('AND IT READS THE CALLER\'S OWN ROW, never an id from the query string', async () => {
        //   Vacuity guard against the commonest shape of this defect: the id
        //   comes from the session, so `?userId=` cannot redirect the lookup.
        store.seed(COLLECTIONS.MARKETPLACE_SELLERS, 'user-1', { verificationStatus: 'approved' });
        store.seed(COLLECTIONS.MARKETPLACE_SELLERS, 'someone-else', { verificationStatus: 'suspended' });

        const res: any = await (await route())(
            get('/api/marketplace/seller-status?userId=someone-else'),
        );

        expect((await res.json()).status).toBe('approved');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/cooperative/fixed-savings', () => {
    const route = async () => (await import('@/app/api/cooperative/fixed-savings/route')).GET;

    it('AN ANONYMOUS CALLER IS REFUSED', async () => {
        actAs(null);

        expect((await (await route())(get('/api/cooperative/fixed-savings'))).status).toBe(401);
    });

    it('AND THE PLANS ARE READ FOR THE SESSION\'S OWN MEMBER', async () => {
        readFixedSavingsPlans.mockResolvedValue([{ id: 'plan-1', status: 'matured' }]);

        const res: any = await (await route())(
            get('/api/cooperative/fixed-savings?userId=someone-else'),
        );

        expect(readFixedSavingsPlans).toHaveBeenCalledWith('user-1');
        expect(await res.json()).toMatchObject({ success: true, plans: [{ id: 'plan-1' }] });
    });

    it('AND A FAILED READ IS A 500, not an empty list', async () => {
        //   An empty list would tell a member their savings are gone. The
        //   failed-read-rendered-as-absence shape this audit keeps finding.
        readFixedSavingsPlans.mockRejectedValue(new Error('down'));

        const res: any = await (await route())(get('/api/cooperative/fixed-savings'));

        expect(res.status).toBe(500);
        expect(await res.json()).toMatchObject({ success: false });
    });
});
