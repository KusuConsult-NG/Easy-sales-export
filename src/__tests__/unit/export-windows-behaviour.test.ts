/**
 * @jest-environment node
 */

/**
 * export/_ex_windows.ts, EXECUTED. It was at 23.9%.
 *
 *   #220 FILTERING THE EXPORT WINDOW LIST BY DATE RETURNED NOTHING. EVER.
 *
 *        The filter ran in memory, over SERIALIZED documents:
 *
 *            const createdDate = exp.createdAt;          // an ISO STRING
 *            return createdDate >= new Date(fromDate)    // string >= Date
 *
 *        serializeDoc turns a Timestamp into an ISO string, and `>=` between a
 *        string and a Date coerces the Date to a number and then the string to
 *        a number — Number("2026-05-01T00:00:00.000Z") is NaN, and every
 *        comparison with NaN is false. In BOTH directions, so `<=` failed too.
 *        Verified by running the comparison, not by reading it.
 *
 *        The member picked a date range and saw an empty list, indistinguishable
 *        from having no export windows in it. The filter moves into the query,
 *        where it belongs: the note it replaces — "date filtering + pagination
 *        is complex in NoSQL without composite indexes" — describes Firestore,
 *        and this runs on Postgres.
 *
 *   #221 A FAILED COMPLIANCE CHECK BURNED THE IDEMPOTENCY KEY.
 *        claimIdempotencyKey ran BEFORE the KYC and registration checks, and
 *        both threw — so the key was claimed and never released.
 *        ExportWindowModal generates one key when the modal OPENS and never
 *        regenerates it. The member read "You must complete KYC verification",
 *        completed their KYC, pressed Create again in the same open modal, and
 *        got "Duplicate transaction detected. Please wait." — a message telling
 *        them to wait for something that would never resolve, escapable only by
 *        closing and reopening the modal.
 *
 *   #222 AND A PRECEDENCE BUG IN THE CATCH COULD THROW.
 *
 *            if (error.message && error.message.includes("Duplicate") || error.message.includes("Compliance"))
 *
 *        groups as `(A && B) || C`, so whenever error.message was undefined the
 *        first half was falsy and the SECOND .includes ran on undefined — a
 *        TypeError raised inside the catch block, turning a handled failure into
 *        an unhandled rejection out of a server action. The `error.message &&`
 *        was plainly meant to protect both.
 *
 *   #223 A FAILED EMAIL LEFT THAT INVESTOR'S SLOT OPEN FOR EVER.
 *        Each callback emailed the investor and THEN marked the slot completed,
 *        so an email that threw skipped the write beside it. The status
 *        transition had ALREADY been claimed, so there was no second chance —
 *        calling the action again returns "Status is already completed". That
 *        slot stayed `status: "active"` permanently while the window said
 *        settled. The slot closes FIRST now: the money outcome is not contingent
 *        on a mail server.
 *
 *        A CORRECTION I MADE TO MYSELF, kept because the mistake is the
 *        instructive part. I first wrote this up as "Promise.all abandons the
 *        remaining investors", and mutation-testing disproved it: swapping
 *        allSettled back to all failed NO test, because .map() has already
 *        started every promise and a rejection abandons only the AWAIT. Every
 *        investor was in fact emailed. What Promise.all really cost was
 *        VISIBILITY — the aggregate rejection reached one generic catch, so
 *        nobody could tell which investors had been missed or how many.
 *        allSettled counts and names them. The ordering was the live defect;
 *        the aggregation was a reporting one.
 *
 *   #224 THE EXPORT ADMIN COULD SETTLE A WINDOW AND NOT OPEN IT.
 *        getExportWindowDetailsAction used a hand-written `admin ||
 *        super_admin` read from the session TOKEN, while both WRITE actions in
 *        the same file resolve roles from the database and ask
 *        hasExportAdminAccess, which recognises export_admin. Both of those
 *        carry comments recording that they fixed exactly this divergence; the
 *        read was left behind.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

const mockClaimKey = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    claimIdempotencyKey: (...a: any[]) => mockClaimKey(...a),
}));

const mockClaimTransition = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (...a: any[]) => mockClaimTransition(...a),
    claimStatusTransition: (...a: any[]) => mockClaimTransition(...a),
}));

const sendCompleteEmail = jest.fn(async () => ({ success: true })) as jest.Mock<any>;
jest.mock('@/lib/email-notifications', () => ({
    sendExportWindowCompleteEmail: (...a: any[]) => sendCompleteEmail(...a),
    getBaseUrl: () => 'https://www.easysalesexport.com',
}));

let store: FakeDbHandle;
const USERS = COLLECTIONS.USERS;
const WINDOWS = COLLECTIONS.EXPORT_WINDOWS;
const SLOTS = COLLECTIONS.EXPORT_SLOTS;
const OWNER = 'exporter-1';

const windows = async () => await import('@/app/actions/export/_ex_windows');

const sessionFor = (id: string, roles: string[] = []) => ({
    session: { user: { id, email: `${id}@e.com`, roles } },
});

const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
};

const validForm = (over: Record<string, string> = {}) => form({
    idempotencyKey: 'key-1',
    commodity: 'sesame',
    quantity: '20 tonnes',
    amount: '5000000',
    deliveryDate: '2026-09-01',
    destination: 'europe',
    ...over,
});

/** A compliant exporter. */
const seedCompliantOwner = () => {
    store.seed(USERS, OWNER, {
        email: 'exporter@e.com',
        isVerified: true,
        cacNumber: 'RC-123456',
        roles: ['user'],
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireSession.mockResolvedValue(sessionFor(OWNER));
    mockClaimKey.mockResolvedValue({ claimed: true });
    mockClaimTransition.mockResolvedValue({ claimed: true, status: 'pending' });
    sendCompleteEmail.mockResolvedValue({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#221/#222 — a compliance failure is recoverable', () => {
    const create = async (over: Record<string, string> = {}) =>
        (await windows()).createExportWindowAction(null as never, validForm(over) as never) as any;

    it('DOES NOT CLAIM THE KEY WHEN KYC IS INCOMPLETE', async () => {
        store.seed(USERS, OWNER, { email: 'e@e.com', isVerified: false, cacNumber: 'RC-1' });

        const res = await create();

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/KYC/);
        // Was: claimed first, so the retry after completing KYC — with the same
        // key, which the modal never regenerates — was refused as a duplicate.
        expect(mockClaimKey).not.toHaveBeenCalled();
    });

    it('DOES NOT CLAIM THE KEY WHEN THE EXPORT REGISTRATION IS MISSING', async () => {
        store.seed(USERS, OWNER, { email: 'e@e.com', isVerified: true });

        const res = await create();

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Registration/i);
        expect(mockClaimKey).not.toHaveBeenCalled();
    });

    it('SO THE SAME KEY STILL WORKS ONCE THE PROBLEM IS FIXED', async () => {
        store.seed(USERS, OWNER, { email: 'e@e.com', isVerified: false, cacNumber: 'RC-1' });
        expect((await create()).success).toBe(false);

        // The member completes KYC and presses Create again, same modal, same key.
        store.seed(USERS, OWNER, { email: 'e@e.com', isVerified: true, cacNumber: 'RC-1' });

        const res = await create();
        expect(res.success).toBe(true);
        expect(store.size(WINDOWS)).toBe(1);
    });

    it('creates the window for a compliant exporter', async () => {
        seedCompliantOwner();

        const res = await create();

        expect(res.success).toBe(true);
        const [[, w]] = store.all(WINDOWS);
        expect(w).toMatchObject({
            commodity: 'sesame', status: 'pending',
            userId: OWNER, windowKind: 'shipment',
        });
    });

    it('still refuses a genuinely duplicate submission', async () => {
        seedCompliantOwner();
        mockClaimKey.mockResolvedValue({ claimed: false });

        expect(await create()).toMatchObject({ success: false });
        expect(store.size(WINDOWS)).toBe(0);
    });

    it('refuses a submission with no security token', async () => {
        seedCompliantOwner();
        const fd = validForm();
        fd.delete('idempotencyKey');

        const res = await (await windows())
            .createExportWindowAction(null as never, fd as never) as any;

        expect(res.success).toBe(false);
        expect(mockClaimKey).not.toHaveBeenCalled();
    });

    it('DOES NOT THROW OUT OF ITS OWN CATCH when the error has no message', async () => {
        seedCompliantOwner();
        // A non-Error thrown from below: `error.message` is undefined, and the
        // old guard evaluated `.includes` on it.
        mockClaimKey.mockRejectedValue({ code: 'PGRST301' });

        const res = await create();

        expect(res.success).toBe(false);
        expect(typeof res.error).toBe('string');
    });

    it('reports a validation failure rather than a generic one', async () => {
        seedCompliantOwner();

        expect(await create({ commodity: '' })).toMatchObject({ success: false });
        expect(store.size(WINDOWS)).toBe(0);
    });

    it('refuses a caller with no session', async () => {
        mockRequireSession.mockResolvedValue({ session: null });
        expect(await create()).toMatchObject({ success: false });
        expect(mockClaimKey).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#220 — the date filter actually filters', () => {
    const seedWindow = (id: string, isoDate: string) => {
        store.seed(WINDOWS, id, {
            orderId: id, userId: OWNER, status: 'pending', commodity: 'sesame',
            createdAt: isoDate,
        });
    };

    beforeEach(() => {
        seedWindow('w-jan', '2026-01-15T00:00:00.000Z');
        seedWindow('w-may', '2026-05-15T00:00:00.000Z');
        seedWindow('w-sep', '2026-09-15T00:00:00.000Z');
    });

    const list = async (...args: any[]) =>
        (await windows()).getExportWindowsAction(...args) as any;

    it('RETURNS THE ROWS IN RANGE, NOT AN EMPTY LIST', async () => {
        const res = await list(undefined, '2026-04-01', '2026-06-30');

        // Was: []. A string compared to a Date is NaN-false in both directions,
        // so any date range returned nothing at all.
        expect(res.success).toBe(true);
        expect(res.data.map((w: any) => w.orderId)).toEqual(['w-may']);
    });

    it('honours a from-date on its own', async () => {
        const res = await list(undefined, '2026-05-01');
        expect(res.data.map((w: any) => w.orderId).sort()).toEqual(['w-may', 'w-sep']);
    });

    it('honours a to-date on its own', async () => {
        const res = await list(undefined, undefined, '2026-05-31');
        expect(res.data.map((w: any) => w.orderId).sort()).toEqual(['w-jan', 'w-may']);
    });

    it('includes a window created on the boundary day', async () => {
        const res = await list(undefined, '2026-05-15', '2026-05-15');
        expect(res.data.map((w: any) => w.orderId)).toEqual(['w-may']);
    });

    it('returns everything when no range is given', async () => {
        expect((await list()).data).toHaveLength(3);
    });

    it('never returns another exporter\'s windows', async () => {
        store.seed(WINDOWS, 'theirs', {
            orderId: 'theirs', userId: 'somebody-else', status: 'pending',
            createdAt: '2026-05-16T00:00:00.000Z',
        });

        expect((await list(undefined, '2026-05-01', '2026-05-31'))
            .data.map((w: any) => w.orderId)).toEqual(['w-may']);
    });

    it('filters by status alongside the dates', async () => {
        store.seed(WINDOWS, 'w-done', {
            orderId: 'w-done', userId: OWNER, status: 'completed',
            createdAt: '2026-05-20T00:00:00.000Z',
        });

        const res = await list('completed', '2026-05-01', '2026-05-31');
        expect(res.data.map((w: any) => w.orderId)).toEqual(['w-done']);
    });

    it('DOES NOT OFFER A PAGE IT CANNOT DELIVER', async () => {
        const res = await list(undefined, undefined, undefined, 3);

        expect(res.data).toHaveLength(3);
        // Was: hasMore true because the page was full, and the next page empty.
        expect(res.meta.hasMore).toBe(false);
        expect(res.meta.cursor).toBeNull();
    });

    it('says there is more when there genuinely is', async () => {
        const res = await list(undefined, undefined, undefined, 2);
        expect(res.data).toHaveLength(2);
        expect(res.meta.hasMore).toBe(true);
        expect(res.meta.cursor).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#223 — completing a window settles every investor', () => {
    const seedSlots = (n: number) => {
        for (let i = 0; i < n; i++) {
            store.seed(USERS, `inv-${i}`, { email: `inv${i}@e.com`, name: `Investor ${i}` });
            store.seed(SLOTS, `slot-${i}`, {
                exportId: 'w1', userId: `inv-${i}`, status: 'active',
                amount: 100_000, expectedReturn: 15_000,
            });
        }
    };

    beforeEach(() => {
        store.seed(WINDOWS, 'w1', {
            orderId: 'w1', userId: OWNER, status: 'delivered',
            title: 'Cocoa Window Q2', roi: '15%',
        });
        store.seed(USERS, OWNER, { email: 'exporter@e.com', roles: ['export_admin'] });
        mockRequireSession.mockResolvedValue(sessionFor(OWNER, ['export_admin']));
    });

    const complete = async () =>
        (await windows()).updateExportStatusAction('w1', 'completed') as any;

    it('notifies every investor and closes every slot', async () => {
        seedSlots(3);

        expect(await complete()).toMatchObject({ success: true });

        expect(sendCompleteEmail).toHaveBeenCalledTimes(3);
        expect(store.all(SLOTS).every(([, s]) => s.status === 'completed')).toBe(true);
    });

    it('every investor is still attempted when one email fails', async () => {
        seedSlots(3);
        sendCompleteEmail
            .mockRejectedValueOnce(new Error('mailbox full'))
            .mockResolvedValue({ success: true });

        expect(await complete()).toMatchObject({ success: true });

        // This held under Promise.all too — see the correction in the header.
        // Kept as the control for the assertion below, which is the one that
        // distinguishes the fix.
        expect(sendCompleteEmail).toHaveBeenCalledTimes(3);
    });

    it('AND THE SLOT CLOSES EVEN WHEN ITS EMAIL DOES NOT', async () => {
        seedSlots(2);
        sendCompleteEmail.mockRejectedValue(new Error('provider down'));

        await complete();

        // The money outcome is not contingent on a mail server. Was: emailed
        // first, marked second, so a mail failure left the slot open for ever.
        expect(store.all(SLOTS).every(([, s]) => s.status === 'completed')).toBe(true);
    });

    it('skips a slot with no investor attached without failing the rest', async () => {
        seedSlots(2);
        store.seed(SLOTS, 'orphan', { exportId: 'w1', status: 'active', amount: 1 });

        expect(await complete()).toMatchObject({ success: true });
        expect(sendCompleteEmail).toHaveBeenCalledTimes(2);
    });

    it('does not notify the investors of another window', async () => {
        seedSlots(1);
        store.seed(USERS, 'other-inv', { email: 'other@e.com' });
        store.seed(SLOTS, 'other-slot', {
            exportId: 'w2', userId: 'other-inv', status: 'active', amount: 5,
        });

        await complete();

        expect(sendCompleteEmail).toHaveBeenCalledTimes(1);
        expect(store.get(SLOTS, 'other-slot')?.status).toBe('active');
    });

    it('does not notify when the status claim was lost to another caller', async () => {
        seedSlots(2);
        mockClaimTransition.mockResolvedValue({ claimed: false, status: 'completed' });

        expect(await complete()).toMatchObject({ success: false });
        expect(sendCompleteEmail).not.toHaveBeenCalled();
    });

    it('does not notify for a status that is not completion', async () => {
        seedSlots(2);

        await (await windows()).updateExportStatusAction('w1', 'in_transit');

        expect(sendCompleteEmail).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#224 — who may open an export window', () => {
    beforeEach(() => {
        store.seed(WINDOWS, 'w1', { orderId: 'w1', userId: OWNER, status: 'pending' });
    });

    const view = async () =>
        (await windows()).getExportWindowDetailsAction('w1') as any;

    it('ADMITS THE EXPORT ADMIN, who can already settle and edit it', async () => {
        store.seed(USERS, 'ea', { email: 'ea@e.com', roles: ['export_admin'] });
        mockRequireSession.mockResolvedValue(sessionFor('ea', ['export_admin']));

        // Was: "Unauthorized to view this export" — the role could close the
        // window and not open it.
        expect(await view()).toMatchObject({ success: true });
    });

    it('admits the owner', async () => {
        store.seed(USERS, OWNER, { email: 'e@e.com', roles: ['user'] });
        expect(await view()).toMatchObject({ success: true });
    });

    it('reads the roles from the database, not the session token', async () => {
        // The token is stale — it still says export_admin — but the record does
        // not. The two writes in this file already resolve roles this way.
        store.seed(USERS, 'ex-admin', { email: 'x@e.com', roles: ['user'] });
        mockRequireSession.mockResolvedValue(sessionFor('ex-admin', ['export_admin']));

        expect(await view()).toMatchObject({ success: false });
    });

    it('refuses an unrelated member', async () => {
        store.seed(USERS, 'nobody', { email: 'n@e.com', roles: ['user'] });
        mockRequireSession.mockResolvedValue(sessionFor('nobody'));

        expect(await view()).toMatchObject({ success: false });
    });

    it('says so when the window does not exist', async () => {
        store.seed(USERS, OWNER, { email: 'e@e.com', roles: ['user'] });
        expect(await (await windows()).getExportWindowDetailsAction('nope'))
            .toMatchObject({ success: false });
    });

    it('the legacy alias resolves to the same answer', async () => {
        store.seed(USERS, OWNER, { email: 'e@e.com', roles: ['user'] });
        expect(await (await windows()).getExportRequestByIdAction('w1'))
            .toMatchObject({ success: true });
    });
});
