/**
 * @jest-environment node
 */

/**
 *   A PAID, ACTIVE COOPERATIVE MEMBER WITH NO NAME, NO PHONE, NO DATE OF
 *   BIRTH, NO OCCUPATION, NO LGA, NO WARD AND NO ADDRESS.
 *
 *   THE OWNER, reading a member on /admin/cooperatives/members:
 *
 *       Application Status: active   Payment: completed   Tier: Member
 *       Fee: ₦0
 *       Full Name —          Email alzakkatintegratedltd@gmail.com
 *       Phone —              Member Number ESE-COOP-4827
 *       Date of Birth —      Gender male
 *       Occupation —         State of Origin Kogi
 *       LGA —                Ward —
 *       Residential Address —
 *
 *   Their words: "missing details for this user and others".
 *
 * ── THE SHAPE OF WHAT SURVIVED IS THE DIAGNOSIS ─────────────────────────────
 *
 *   Three fields filled and every other one did not, and the three say where
 *   the record came from:
 *
 *     Email            the one blank field with a fallback to the USERS row
 *     Gender, State    the two fields updateMemberProfileDetailsAction writes,
 *                      from the member's own ID-card page
 *     everything else  reachable only from the onboarding form
 *
 *   So the row being displayed was never the row the onboarding form wrote to.
 *
 * ── ONE PERSON, TWO MEMBERSHIP ROWS ─────────────────────────────────────────
 *
 *   api/cooperatives/register files the whole profile under an AUTO-GENERATED
 *   document id and hands that id to Paystack as `metadata.membershipId`.
 *
 *   The webhook honours it — `if (membershipId) memberRef = ...doc(membershipId)`
 *   in infrastructure/payments/service.ts. The CLIENT half of the same
 *   payment, which races the webhook by design, opened with
 *
 *       const membershipRef = db.collection(COOPERATIVE_MEMBERS).doc(userId);
 *
 *   and fulfilled there with set(merge:true) — which CREATES the document. So
 *   the callback page manufactured a second membership row carrying the money
 *   and nothing else, and left the real one pending and unpaid for ever.
 *
 *   `registrationFee` is written by the registration route and by nothing on
 *   the payment path, which is the "Fee: ₦0" beside a completed payment.
 *
 *   Worse on the LOST claim: when the webhook won and had already fulfilled
 *   the correct row, syncAlreadyProcessed still wrote doc(userId) — so the
 *   blank duplicate appeared even where nothing needed creating. That is why
 *   it is "this user and others" rather than a race that bites occasionally.
 *
 * ── BOTH HALVES ARE TESTED HERE ─────────────────────────────────────────────
 *
 *   The writer, so no further member is split in two; and the reader, because
 *   the rows already in the database are not reachable by fixing the writer.
 */

import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

jest.mock('@/lib/cooperative-admin-scope', () => ({
    getAdminScope: async () => null,
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateServiceCache: async () => undefined,
    invalidateCooperativeCache: async () => undefined,
    invalidateAdminGlobalStats: async () => undefined,
    deleteCache: async () => undefined,
}));

const mockClaim = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaim(...a),
    markFulfilmentFailed: jest.fn(),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
}));

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: () => Promise.resolve({ success: true }) }),
    getClientIp: () => '127.0.0.1',
    createRateLimitResponse: () => ({ status: 429 }),
}));

jest.mock('@/lib/schema-normalizer', () => ({
    normalizeUserDoc: (d: any) => d,
    normalizeUserUpdate: (d: any) => d,
}));

// ─── the member the owner photographed ───────────────────────────────────────

const MEMBER_UID = 'user-alzakkat';
/** The auto-generated id api/cooperatives/register files the profile under. */
const DETAIL_ROW = 'membership-auto-4827';
const REFERENCE = 'COOP-REF-4827';

/** What the onboarding form wrote — the row nobody was looking at. */
const DETAILS = {
    userId: MEMBER_UID,
    cooperativeId: 'default',
    firstName: 'Musa',
    middleName: 'Ibrahim',
    lastName: 'Abdullahi',
    dateOfBirth: '1984-03-11',
    gender: 'male',
    email: 'alzakkatintegratedltd@gmail.com',
    phone: '+2348030001111',
    stateOfOrigin: 'Kogi',
    lga: 'Okene',
    ward: 'Okene Central',
    residentialAddress: '14 Market Road, Okene',
    occupation: 'Trader',
    membershipTier: 'Member',
    registrationFee: 10000,
    membershipStatus: 'pending',
    paymentReference: REFERENCE,
    onboardingCompleted: true,
    createdAt: '2026-01-04T09:00:00.000Z',
};

/** What the client callback manufactured: the money, and nothing else. */
const BLANK_PAID_ROW = {
    userId: MEMBER_UID,
    membershipTier: 'Member',
    membershipStatus: 'active',
    paymentStatus: 'completed',
    paymentReference: REFERENCE,
    //   The ID-card editor reached this row, being the newest, and wrote the
    //   only two fields it writes.
    gender: 'male',
    stateOfOrigin: 'Kogi',
    createdAt: '2026-01-04T09:05:00.000Z',
};

let store: FakeDbHandle;

const originalFetch = global.fetch;
const originalKey = process.env.PAYSTACK_SECRET_KEY;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    mockClaim.mockResolvedValue({ claimed: true, status: 'completed' });
});

afterAll(() => {
    global.fetch = originalFetch;
    process.env.PAYSTACK_SECRET_KEY = originalKey;
});

// ─────────────────────────────────────────────────────────────────────────────
// THE READER — the rows already in the database
// ─────────────────────────────────────────────────────────────────────────────

function seedTheSplitMember() {
    store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'], email: 'admin@ese.ng' });
    //   A thin user row. This is the other half of why the screen was blank:
    //   the USERS hydration that was already here had nothing to give.
    store.seed(COLLECTIONS.USERS, MEMBER_UID, { email: 'alzakkatintegratedltd@gmail.com' });
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, DETAIL_ROW, DETAILS);
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_UID, BLANK_PAID_ROW);
    mockRequireSession.mockResolvedValue({
        session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'admin@ese.ng' } },
        error: null,
    });
}

async function membersPage() {
    const { getStandardCooperativeMembersAction } =
        await import('@/app/actions/cooperative/_coop_admin_members');
    return await getStandardCooperativeMembersAction({ limit: 50 }) as any;
}

describe('the admin member screen, on a member split across two rows', () => {
    it('THE REPORTED DEFECT: the paid row shows the details instead of seven dashes', async () => {
        seedTheSplitMember();

        const res = await membersPage();
        const paid = res.data.find((r: any) => r.id === MEMBER_UID);

        expect(paid).toBeDefined();
        //   Every field the owner photographed as "—".
        expect(paid.data).toMatchObject({
            firstName: 'Musa',
            middleName: 'Ibrahim',
            lastName: 'Abdullahi',
            phone: '+2348030001111',
            dateOfBirth: '1984-03-11',
            occupation: 'Trader',
            lga: 'Okene',
            ward: 'Okene Central',
            residentialAddress: '14 Market Road, Okene',
        });
    });

    it('AND "Fee: ₦0" becomes the fee that was actually charged', async () => {
        seedTheSplitMember();

        const res = await membersPage();
        const paid = res.data.find((r: any) => r.id === MEMBER_UID);

        expect(paid.data.registrationFee).toBe(10000);
    });

    it('says which record the details were read from', async () => {
        //   An admin comparing this against the roster must not have to guess
        //   why the record is fuller than the row they opened.
        seedTheSplitMember();

        const res = await membersPage();
        const paid = res.data.find((r: any) => r.id === MEMBER_UID);

        expect(paid.data._detailsFromMemberRow).toBe(DETAIL_ROW);
    });

    it('CANNOT REPLACE A FIELD THE ROW ALREADY HAS', async () => {
        //   The vacuity control on the merge. If a sibling could overwrite,
        //   this suite would pass on code that corrupts complete members.
        store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'], email: 'admin@ese.ng' });
        store.seed(COLLECTIONS.USERS, MEMBER_UID, { email: 'alzakkatintegratedltd@gmail.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, DETAIL_ROW, { ...DETAILS, firstName: 'STALE' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_UID, {
            ...BLANK_PAID_ROW, firstName: 'Musa', lastName: 'Abdullahi',
        });
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'admin@ese.ng' } },
            error: null,
        });

        const res = await membersPage();
        const paid = res.data.find((r: any) => r.id === MEMBER_UID);

        expect(paid.data.firstName).toBe('Musa');
    });

    it('LEAVES A MEMBER WITH ONE ROW EXACTLY AS IT FOUND THEM', async () => {
        //   The other vacuity control: the change must be invisible to the
        //   members — nearly all of them — who were never split.
        store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'], email: 'admin@ese.ng' });
        store.seed(COLLECTIONS.USERS, 'solo-uid', { email: 'solo@ese.ng' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'solo-uid', {
            ...DETAILS, userId: 'solo-uid', paymentStatus: 'completed', membershipStatus: 'active',
        });
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'admin@ese.ng' } },
            error: null,
        });

        const res = await membersPage();
        const solo = res.data.find((r: any) => r.id === 'solo-uid');

        expect(solo.data.firstName).toBe('Musa');
        expect(solo.data._detailsFromMemberRow).toBeUndefined();
    });

    it('WRITES NOTHING — displaying is not repairing', async () => {
        seedTheSplitMember();
        const before = JSON.stringify(store.all(COLLECTIONS.COOPERATIVE_MEMBERS));

        await membersPage();

        expect(JSON.stringify(store.all(COLLECTIONS.COOPERATIVE_MEMBERS))).toBe(before);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE WRITER — so no further member is split
// ─────────────────────────────────────────────────────────────────────────────

/** Paystack confirms the fee, and names the row the payment was raised for. */
function paystackSaysPaid(membershipId: string | null = DETAIL_ROW) {
    (global as any).fetch = jest.fn(() => Promise.resolve({
        ok: true,
        json: async () => ({
            status: true,
            data: {
                status: 'success',
                amount: 10_000 * 100,
                metadata: { userId: MEMBER_UID, ...(membershipId ? { membershipId } : {}) },
            },
        }),
    })) as any;
}

async function verifyPayment() {
    const { POST } = await import('@/app/api/cooperative/verify-payment/route');
    return POST({ json: async () => ({ reference: REFERENCE }) } as any);
}

function seedAwaitingPayment() {
    store.seed(COLLECTIONS.USERS, MEMBER_UID, { email: 'alzakkatintegratedltd@gmail.com' });
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, DETAIL_ROW, DETAILS);
    mockRequireSession.mockResolvedValue({
        session: {
            user: { id: MEMBER_UID, email: 'alzakkatintegratedltd@gmail.com', roles: ['user'] },
        },
        error: null,
    });
}

describe('api/cooperative/verify-payment, on a profile filed under an auto id', () => {
    it('THE CAUSE: fulfils onto the row the payment names', async () => {
        seedAwaitingPayment();
        paystackSaysPaid();

        await verifyPayment();

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, DETAIL_ROW))
            .toMatchObject({ paymentStatus: 'completed', paymentReference: REFERENCE });
    });

    it('AND MANUFACTURES NO SECOND ROW AT doc(userId)', async () => {
        //   THE test. The fulfilment used set(merge:true) on doc(userId),
        //   which creates. One member, one row.
        seedAwaitingPayment();
        paystackSaysPaid();

        await verifyPayment();

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_UID)).toBeUndefined();
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(1);
    });

    it('so the member the fee bought keeps their name and their fee', async () => {
        seedAwaitingPayment();
        paystackSaysPaid();

        await verifyPayment();

        //   The name and the money on ONE row. Asserted together, because
        //   either half alone was already true before the fix — the profile
        //   row kept its name and the blank row took the payment.
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, DETAIL_ROW)).toMatchObject({
            firstName: 'Musa',
            residentialAddress: '14 Market Road, Okene',
            registrationFee: 10000,
            paymentStatus: 'completed',
        });
    });

    it('THE LOST CLAIM — the webhook won — still writes no duplicate', async () => {
        //   The path that produced most of them: nothing needed creating and
        //   syncAlreadyProcessed created it anyway.
        seedAwaitingPayment();
        paystackSaysPaid();
        mockClaim.mockResolvedValue({ claimed: false, status: 'completed' });

        await verifyPayment();

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_UID)).toBeUndefined();
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(1);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, DETAIL_ROW))
            .toMatchObject({ paymentStatus: 'completed' });
    });

    it('A LEGACY REFERENCE CARRYING NO membershipId still finds the row', async () => {
        //   The webhook's own branch makes this allowance and so must this
        //   one — falling back to the two-key walk rather than to a new row.
        seedAwaitingPayment();
        paystackSaysPaid(null);

        await verifyPayment();

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, DETAIL_ROW))
            .toMatchObject({ paymentStatus: 'completed' });
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(1);
    });

    it('REFUSES A membershipId BELONGING TO SOMEBODY ELSE', async () => {
        //   The metadata comes back from Paystack's own API, so it is ours.
        //   The check is there so that stays true if it ever is not.
        seedAwaitingPayment();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'someone-elses-row', {
            userId: 'another-member', firstName: 'Ngozi', membershipStatus: 'active',
        });
        paystackSaysPaid('someone-elses-row');

        await verifyPayment();

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'someone-elses-row'))
            .not.toMatchObject({ paymentReference: REFERENCE });
        //   Refused, and then resolved the proper way — not refused into
        //   doing nothing, and not refused into a fresh blank row.
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, DETAIL_ROW))
            .toMatchObject({ paymentStatus: 'completed' });
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_UID)).toBeUndefined();
    });

    it('a member with NO row at all still gets one', async () => {
        //   The third rung of the ladder must still be there.
        store.seed(COLLECTIONS.USERS, MEMBER_UID, { email: 'alzakkatintegratedltd@gmail.com' });
        mockRequireSession.mockResolvedValue({
            session: { user: { id: MEMBER_UID, email: 'x@y.z', roles: ['user'] } }, error: null,
        });
        paystackSaysPaid(null);

        await verifyPayment();

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_UID))
            .toMatchObject({ paymentStatus: 'completed' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE EXPORT — the file an admin actually hands around
// ─────────────────────────────────────────────────────────────────────────────

describe('the cooperative members export, on the same split member', () => {
    async function exportCsv() {
        const { GET } = await import('@/app/api/admin/export/cooperative-members/route');
        const res = await GET({
            url: 'https://ese.ng/api/admin/export/cooperative-members',
        } as any);
        return await (res as any).text();
    }

    beforeEach(() => {
        seedTheSplitMember();
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'admin@ese.ng' } },
            error: null,
        });
    });

    it('THE REPORTED DEFECT, on the CSV: the paid row is not a blank line', async () => {
        const csv = await exportCsv();

        //   Two rows for one person — both still exported, and NEITHER of
        //   them empty. The name, phone, occupation and LGA appear twice
        //   because the member appears twice; that is the data, honestly
        //   reported, and collapsing it is a separate decision.
        const withName = csv.split('\n').filter((l: string) => l.includes('Abdullahi'));
        expect(withName.length).toBe(2);
        for (const line of withName) {
            expect(line).toContain('Trader');
            expect(line).toContain('Okene');
        }
    });

    it('and the fee on the row that carries the payment is not 0', async () => {
        const csv = await exportCsv();
        const paidLine = csv.split('\n').find((l: string) => l.includes('completed'));

        expect(paidLine).toBeDefined();
        expect(paidLine).toContain('10000');
    });
});
