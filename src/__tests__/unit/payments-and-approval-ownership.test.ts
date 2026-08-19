/**
 * @jest-environment node
 */

/**
 * One IDOR in the file under audit, and three more the tool that should have
 * found it was blind to.
 *
 * THE FILE UNDER AUDIT
 * --------------------
 * payments.ts has three exports. Two were closed in an earlier pass:
 * createPaymentRecordAction stopped trusting a caller-supplied userId, and
 * getPaymentByReferenceAction stopped serving a record to anyone holding a
 * reference. The third kept the exact shape both were fixed for:
 *
 *     const sessionResult = await requireSession();
 *     if (sessionResult.error) return [];
 *     ... .where("userId", "==", userId)      // userId is the ARGUMENT
 *
 * The session was fetched and never consulted, so any authenticated user could
 * read anybody's payment history. `payments` is live and populated —
 * farm-nation-payment.ts, marketplace/_payment.ts and
 * infrastructure/payments/service.ts all write real rows carrying userEmail,
 * amount, purpose, relatedId and sellerId.
 *
 * WHY THE SCANNER COULD NOT SEE IT
 * --------------------------------
 * ownership-scan.ts existed to catch precisely this and reported nothing, for
 * three separate reasons — each fixed, each with tests in ownership-scan.test.ts:
 *
 *   1. It only considered functions that WRITE. Reading someone else's data is
 *      the same defect. The read half had already been found BY HAND four times.
 *
 *   2. `.where("userId", "==", userId)` counted as evidence ownership had been
 *      checked. For a write that holds. For a read keyed on a caller-supplied
 *      argument it is the opposite — that clause is what serves other people's
 *      rows.
 *
 *   3. `logger.error("...", { userId: session.user.id })` in a catch block
 *      matched the "identity field receives a session value" rule and marked the
 *      whole function safe. That rule exists for `ownerId: session.user.id` on a
 *      RECORD; a log line decides nothing. This is the distinction the rule was
 *      written to make and it was implemented for `updatedBy` only.
 *
 * WHAT FIXING THE SCANNER THEN SURFACED
 * -------------------------------------
 * Three more live defects, in two other files:
 *
 *   approveFarmNationSellerAction   No admin check at all. Stated precisely: NOT
 *                                   a role escalation, because onboarding
 *                                   already self-grants `farmer`. What it does
 *                                   is move serviceRegistrations.farmNation.status
 *                                   from "pending" to "approved", and
 *                                   module-access-check.ts Layer 2 gates module
 *                                   access on exactly that value. So it buys the
 *                                   module past the human review "pending" exists
 *                                   to require.
 *
 *   rejectFarmNationSellerAction    The clearer half: any authenticated user
 *                                   could set ANOTHER user's status to
 *                                   "rejected" and strip their `farmer` role.
 *                                   No self-service path grants this.
 *
 *   getLandInquiriesAction          Read anyone's land inquiries by naming them.
 *                                   _submitLandInquiryAction is public BY DESIGN,
 *                                   and every row it writes carries buyerName,
 *                                   buyerEmail, buyerPhone and the message — so
 *                                   this turned a deliberately open intake form
 *                                   into a bulk export of its contact details.
 *
 * A fourth, getLandInquiryByIdAction, was found by READING the file next door
 * and is still invisible to the scanner: a single document fetched by id with no
 * ownership check takes no userId and runs no `.where`, so no rule catches it.
 *
 * farm-nation.ts had a third admin action, _verifyPropertyAction, which was
 * already guarded. One of three checked and two not.
 *
 * TRIAGED AND LEFT
 * ----------------
 * _getSellerReviewSummaryAction is now a lead and is NOT a defect: a seller's
 * average rating over approved reviews is public by design, and the action
 * deliberately tolerates having no session at all.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const OWNER = 'owner-1';
const STRANGER = 'stranger-1';
const ADMIN = 'admin-1';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    recordAdminAction: jest.fn(async () => undefined),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

/** Answers reads with `rows` for queries and `doc` for document fetches. */
function setWorld(opts: { rows?: any[]; doc?: Record<string, any> | null } = {}) {
    const rows = opts.rows ?? [];
    const docData = opts.doc;
    const answer = {
        exists: docData !== null && docData !== undefined,
        empty: rows.length === 0,
        size: rows.length,
        docs: rows.map((r, i) => ({ id: `row-${i}`, ref: { id: `row-${i}` }, data: () => r })),
        data: () => docData ?? {},
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(answer));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(answer));
}

describe('payment history is only ever your own', () => {
    const HISTORY = [{ userId: OWNER, userEmail: 'owner@e.com', amount: 250_000, purpose: 'escrow_payment' }];

    beforeEach(() => {
        jest.clearAllMocks();
        setWorld({ rows: HISTORY, doc: {} });
    });

    async function history(target: string) {
        const { getUserPaymentHistoryAction } = await import('@/app/actions/payments');
        return getUserPaymentHistoryAction(target);
    }

    it('refuses a caller reading somebody else\'s history', async () => {
        // THE test for the file under audit.
        setSession(STRANGER, ['seller']);

        const r = await history(OWNER);

        expect(r).toEqual([]);
    });

    it('serves a caller their own history', async () => {
        // Vacuity guard: a refusal that also blocked the owner would remove the
        // feature rather than secure it.
        setSession(OWNER, []);

        const r = await history(OWNER);

        expect(r.length).toBe(1);
    });

    it('lets an admin read it', async () => {
        setSession(ADMIN, ['admin']);

        const r = await history(OWNER);

        expect(r.length).toBe(1);
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        expect(await history(OWNER)).toEqual([]);
    });

    it('returns an empty list rather than an error', async () => {
        // Matching getPaymentByReferenceAction: the endpoint does not confirm
        // whose history exists.
        setSession(STRANGER, ['seller']);

        const r = await history(OWNER);

        expect(Array.isArray(r)).toBe(true);
        expect(r).toEqual([]);
    });
});

describe('a payment record cannot be filed under a borrowed email', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(OWNER, []);
        setWorld({ doc: { email: 'real@e.com' } });
    });

    const valid = {
        userId: OWNER,
        userEmail: 'someone.else@victim.com',
        amount: 50_000,
        currency: 'NGN',
        paymentReference: 'PAY-REF-1',
        paymentMethod: 'paystack' as const,
        purpose: 'escrow_payment' as const,
    };

    async function create(overrides: Record<string, any> = {}) {
        const { createPaymentRecordAction } = await import('@/app/actions/payments');
        return createPaymentRecordAction({ ...valid, ...overrides } as any) as any;
    }

    function written(): Record<string, any> | undefined {
        return (global as any).mockFirestoreAdd.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .find((d: any) => d && 'paymentReference' in d);
    }

    it('records the caller\'s own address, not the one in the request', async () => {
        // userEmail arrived beside userId and was written to both the record and
        // the audit row — the same caller-supplied-identity shape as #103, #122
        // and #137, one field along.
        const r = await create();

        expect(r.success).toBe(true);
        expect(written()?.userEmail).toBe(`${OWNER}@e.com`);
        expect(written()?.userEmail).not.toBe('someone.else@victim.com');
    });

    it('refuses a non-positive amount', async () => {
        for (const bad of [0, -50_000]) {
            jest.clearAllMocks();
            const r = await create({ amount: bad });
            expect(r.success).toBe(false);
            expect(written()).toBeUndefined();
        }
    });

    it('refuses an amount that is not a number', async () => {
        const r = await create({ amount: 'lots' });

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });

    it('refuses an empty payment reference', async () => {
        const r = await create({ paymentReference: '   ' });

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });

    it('still refuses filing a payment against another user', async () => {
        // The guard from the earlier pass, pinned so this change cannot loosen
        // it.
        const r = await create({ userId: STRANGER });

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });
});

describe('Farm Nation approval is an admin decision', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld({ rows: [{ userId: OWNER, submittedAt: new Date().toISOString() }], doc: { roles: ['farmer'] } });
    });

    async function approve(target: string) {
        const { approveFarmNationSellerAction } = await import('@/app/actions/farm-nation');
        return approveFarmNationSellerAction(target) as any;
    }

    async function reject(target: string) {
        const { rejectFarmNationSellerAction } = await import('@/app/actions/farm-nation');
        return rejectFarmNationSellerAction(target, 'no reason') as any;
    }

    it('refuses a user approving themselves', async () => {
        // THE test. Not a role escalation — onboarding already self-grants
        // `farmer`. What this buys is the status flip from "pending" to
        // "approved", which module-access-check.ts Layer 2 reads as module
        // access.
        setSession(OWNER, ['farmer']);

        const r = await approve(OWNER);

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreTxUpdate).not.toHaveBeenCalled();
    });

    it('refuses a user approving somebody else', async () => {
        setSession(STRANGER, ['farmer']);

        const r = await approve(OWNER);

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreTxUpdate).not.toHaveBeenCalled();
    });

    it('lets an admin approve', async () => {
        // Vacuity guard. The admin page at /admin/farm-nation/applications is
        // the real caller and has to keep working.
        setSession(ADMIN, ['admin']);

        const r = await approve(OWNER);

        expect(r.success).toBe(true);
        expect((global as any).mockFirestoreTxUpdate).toHaveBeenCalled();
    });

    it('refuses a user stripping another user\'s farmer role', async () => {
        // The clearer half: no self-service path grants this, so it is purely
        // an attack on somebody else's access.
        setSession(STRANGER, ['farmer']);

        const r = await reject(OWNER);

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreTxUpdate).not.toHaveBeenCalled();
    });

    it('lets an admin reject', async () => {
        setSession(ADMIN, ['admin']);

        const r = await reject(OWNER);

        expect(r.success).toBe(true);
    });

    it('refuses an unauthenticated caller either way', async () => {
        setSession(null);

        expect((await approve(OWNER)).success).toBe(false);
        expect((await reject(OWNER)).success).toBe(false);
    });
});

describe('land inquiries reach only the listing owner', () => {
    const INQUIRY = {
        listingOwnerId: OWNER,
        buyerName: 'A Buyer',
        buyerEmail: 'buyer@e.com',
        buyerPhone: '08030000000',
        message: 'Is this still available?',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        setWorld({ rows: [INQUIRY], doc: INQUIRY });
    });

    async function list(target: string) {
        const { getLandInquiriesAction } = await import('@/app/actions/land-listings');
        return getLandInquiriesAction(target) as any;
    }

    async function byId(id: string) {
        const { getLandInquiryByIdAction } = await import('@/app/actions/land-listings');
        return getLandInquiryByIdAction(id) as any;
    }

    it('refuses a caller listing somebody else\'s inquiries', async () => {
        // The intake is public by design, so these rows are contact details
        // collected from people who never made an account.
        setSession(STRANGER, ['farmer']);

        const r = await list(OWNER);

        expect(r.success).toBe(false);
    });

    it('serves the owner their own inquiries', async () => {
        setSession(OWNER, ['farmer']);

        const r = await list(OWNER);

        expect(r.success).toBe(true);
        expect(r.data.length).toBe(1);
    });

    it('lets an admin list them', async () => {
        setSession(ADMIN, ['admin']);

        expect((await list(OWNER)).success).toBe(true);
    });

    it('refuses a stranger fetching one inquiry by id', async () => {
        // The one the scanner still cannot see: no userId parameter, no .where,
        // so neither the read rule nor the write rule has anything to catch.
        setSession(STRANGER, ['farmer']);

        const r = await byId('inq-1');

        expect(r.success).toBe(false);
    });

    it('answers a stranger with "not found", not "unauthorized"', async () => {
        // So the endpoint does not confirm which inquiry ids exist.
        setSession(STRANGER, ['farmer']);

        const r = await byId('inq-1');

        expect(String(r.error)).toMatch(/not found/i);
    });

    it('serves the owner that same inquiry', async () => {
        // Vacuity guard for both assertions above.
        setSession(OWNER, ['farmer']);

        const r = await byId('inq-1');

        expect(r.success).toBe(true);
        expect(r.data.buyerEmail).toBe('buyer@e.com');
    });
});
