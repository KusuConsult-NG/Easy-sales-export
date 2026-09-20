/**
 * @jest-environment node
 */

/**
 *   THE ADMIN ESCROW LIST CAME DOWN, AND #903 HAD ALREADY NAMED THE CAUSE.
 *
 *   FROM THE OWNER'S PRODUCTION LOG, twice in one window:
 *
 *       ⨯ Error: Only plain objects, and a few built-ins, can be passed to
 *         Client Components from Server Components.
 *         {bankCode: "044", bankName: …, verified: …, accountName: …,
 *          accountNumber: …, accountNameSource: …,
 *          accountResolvedAt: {_seconds: …, _nanoseconds: 863000000, …}}
 *
 *   Two occurrences, two different bank codes — two rows of one admin list.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 *
 *   _escrow_actions builds a user map and injects it into every transaction as
 *   `buyerDetails` / `sellerDetails`. The bank block was taken STRAIGHT off the
 *   user document:
 *
 *       bankDetails: data.bankDetails || { …four-field fallback… }
 *
 *   The fallback is all strings and was never the problem. The STORED block is
 *   what bank-account-provenance.ts stamps with `accountResolvedAt` — and a
 *   Timestamp is a class instance, which React refuses.
 *
 *   THE FIELD NAMES IN THE LOG SAY WHICH BRANCH RAN: `verified`,
 *   `accountNameSource` and `accountResolvedAt` appear in the stored block and
 *   in neither the fallback nor any projection.
 *
 * ── #903 IS THIS EXACT FAULT, TWO FILES AWAY ────────────────────────────────
 *
 *   "Server Actions CANNOT pass class instances (like Firestore Timestamps) to
 *   Client Components" — found when one member's date of birth took down the
 *   whole membership list. Its fix was `serializeValue` on a user map built for
 *   injection. This is the same shape, and the same call was missing.
 *
 *   And _marketplace.ts already writes `serializeValue(data.bankDetails || {…})`
 *   for the very same field. The rule existed and reached some of the places it
 *   names, which is this audit's most common finding.
 *
 * ── THE TEST ASSERTS THE RESPONSE, NOT THE REPAIR ───────────────────────────
 *
 *   #903's own suite walks the payload for anything React would refuse rather
 *   than checking that serializeValue is called, because the second kind passes
 *   while the screen is still down. Same walker here, same reason.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { Timestamp } from '@/lib/firestore-compat';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: () => undefined, revalidatePath: () => undefined,
    updateTag: () => undefined, unstable_cache: (fn: any) => fn,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => {
    const actual = jest.requireActual('@/lib/session-guard') as any;
    return { ...actual, requireSession: (...a: any[]) => mockRequireSession(...a) };
});

let store: FakeDbHandle;

const ADMIN = 'admin-1';
const BUYER = 'buyer-1';
const SELLER = 'seller-1';

/**
 * Every value React would refuse to serialise, with the path it sits at.
 *
 * Plain objects, arrays, primitives, null and Date are fine. Anything else with
 * a prototype of its own — a Timestamp, a DocumentReference — is not, and a
 * function anywhere is not. Lifted from #903's suite deliberately: one
 * definition of "what React refuses", not a second opinion.
 */
function unserializable(value: unknown, path = '$'): string[] {
    if (value === null || value === undefined) return [];
    if (typeof value === 'function') return [`${path} (function)`];
    if (typeof value !== 'object') return [];
    if (value instanceof Date) return [];

    if (Array.isArray(value)) {
        return value.flatMap((v, i) => unserializable(v, `${path}[${i}]`));
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        return [`${path} (${(value as any).constructor?.name ?? 'class instance'})`];
    }

    return Object.entries(value as Record<string, unknown>)
        .flatMap(([k, v]) => unserializable(v, `${path}.${k}`));
}

/** The stored block, as bank-account-provenance stamps it. */
const storedBankDetails = (bankCode: string) => ({
    bankCode,
    bankName: 'Access Bank',
    verified: true,
    accountName: 'Ada Obi',
    accountNumber: '0123456789',
    accountNameSource: 'paystack',
    //   THE ONE THAT DOES IT. A Timestamp is a class instance.
    accountResolvedAt: Timestamp.fromDate(new Date('2026-09-01T10:00:00.000Z')),
});

const escrowList = async () => {
    const mod = await import('@/app/actions/marketplace/_escrow_actions');
    return (await mod.getAllEscrowTransactionsAdmin({})) as any;
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();

    //   `finance:resolve_disputes` is what gates the bank block — without it
    //   the branch never runs and this suite would prove nothing.
    mockRequireSession.mockResolvedValue({
        session: { user: { id: ADMIN, roles: ['super_admin'], email: 'a@e.com', name: 'A' } },
        error: null,
    });

    store.seed(COLLECTIONS.USERS, ADMIN, { id: ADMIN, roles: ['super_admin'], email: 'a@e.com' });
    store.seed(COLLECTIONS.USERS, BUYER, {
        id: BUYER, firstName: 'Ada', lastName: 'Obi', email: 'b@e.com',
        bankDetails: storedBankDetails('044'),
    });
    store.seed(COLLECTIONS.USERS, SELLER, {
        id: SELLER, firstName: 'Ben', lastName: 'Eze', email: 's@e.com',
        bankDetails: storedBankDetails('301'),
    });
    store.seed(COLLECTIONS.ESCROW_TRANSACTIONS, 'esc-1', {
        id: 'esc-1', buyerId: BUYER, sellerId: SELLER, amount: 25_000,
        status: 'funded', participants: [BUYER, SELLER],
        createdAt: '2026-09-12T10:00:00.000Z',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the admin escrow list survives a stamped bank account', () => {
    it('THE REPORTED CRASH: nothing in the payload is a class instance', async () => {
        const res = await escrowList();

        expect(res.success).toBe(true);
        expect(unserializable(res.data)).toEqual([]);
    });

    it('AND THE WALKER REALLY WOULD HAVE CAUGHT IT — the control', async () => {
        /*
         *   Vacuity, and the one that matters most in a file shaped like this.
         *   A walker that found nothing anywhere would pass the test above on a
         *   payload that still crashed. Asked of the exact value the log named.
         */
        const found = unserializable({ data: { bankDetails: storedBankDetails('044') } });

        expect(found).toEqual(['$.data.bankDetails.accountResolvedAt (Timestamp)']);
    });

    it('AND THE ACCOUNT IS STILL THERE — serialised, not stripped', async () => {
        //   The other way to make the crash go away is to drop the field, which
        //   would leave the admin approving a payout with nothing to pay into.
        const res = await escrowList();
        const tx = res.data.transactions?.[0] ?? res.data?.[0];

        expect(tx.buyerDetails.bankDetails.accountNumber).toBe('0123456789');
        expect(tx.sellerDetails.bankDetails.bankCode).toBe('301');
    });

    it('AND THE STAMP SURVIVES AS A STRING, not as a Timestamp', async () => {
        const res = await escrowList();
        const tx = res.data.transactions?.[0] ?? res.data?.[0];

        expect(typeof tx.buyerDetails.bankDetails.accountResolvedAt).toBe('string');
    });
});
