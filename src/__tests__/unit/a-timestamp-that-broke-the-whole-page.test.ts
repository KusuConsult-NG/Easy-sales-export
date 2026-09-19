/**
 * @jest-environment node
 */

/**
 *   #903 "Membership applications could not be loaded. Minified React
 *        error #441."
 *
 *   THE OWNER, pasting what the screen said:
 *
 *       "Membership applications could not be loaded
 *        Minified React error #441; visit https://react.dev/errors/441 ...
 *        This is not an empty list — nothing below reflects what is actually
 *        stored."
 *
 *   The last line is #838's banner doing its job: the screen knew it was
 *   showing a failure rather than an empty cooperative. The first two lines are
 *   the defect.
 *
 * ── WHY THE ERROR ARRIVED WITH NO MESSAGE, WHICH IS THE WHOLE DIAGNOSIS ─────
 *
 *   React #441 is thrown by the RSC CLIENT, not by react-dom: it is
 *   `resolveErrorProd`, "an error occurred in the Server Components render",
 *   whose text production deliberately strips.
 *
 *   That rules out the obvious reading. getStandardCooperativeMembersAction
 *   wraps every read in a try/catch that returns the sentence "Failed to load
 *   cooperative members" — so if the ACTION had failed, that sentence is what
 *   the owner would have pasted. It is not. The throw therefore happens after
 *   the action returns, while React serialises the payload, which is also why
 *   the action's own handler could not catch it and why no detail survived.
 *
 *   lib/firestore-serialize's header names the one thing that does this:
 *   "Server Actions CANNOT pass class instances (like Firestore Timestamps) to
 *   Client Components."
 *
 * ── THE SAME RULE, APPLIED TO ONE OF THE THREE PLACES IT NAMES ──────────────
 *
 *   The member rows were serialised — `serializeDocs(snapshot.docs)`. The USER
 *   documents fetched to fill in each member's blanks were not:
 *
 *       userSnapsArray.forEach(snap =>
 *           snap.docs.forEach(d => userMap.set(d.id, d.data())));
 *
 *   and `mergedData` then reads `uData.dateOfBirth || uData.dob` and
 *   `uData.bankDetails` straight out of that map into what is returned. One
 *   member whose ACCOUNT carries a Timestamp date of birth put a Timestamp in
 *   the response and took the entire page down with it — not that one field,
 *   and not that one row.
 *
 *   The sibling action at the top of the same file already wrote
 *   `serializeValue(d.data())` into its user map. The two loops inside this
 *   action did not, and the second of them is the one a page load runs.
 *
 * ── WHAT IS ASSERTED ────────────────────────────────────────────────────────
 *
 *   Not "serializeValue is called" — that pins the repair rather than the
 *   behaviour. The response is walked and asserted to contain nothing React
 *   would refuse: no `toDate`, no non-plain object. That assertion fails
 *   against the old line for the reason the owner's page failed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ data: { id: 'e1' }, error: null }) }; },
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

let store: FakeDbHandle;

const MEMBER = 'member-doc';
const MEMBER_USER = 'member-user';

/**
 * A Firestore Admin Timestamp, as the driver hands one back: a CLASS INSTANCE
 * carrying `toDate`. This is the value React cannot put on the wire.
 */
class FakeTimestamp {
    constructor(public seconds: number, public nanoseconds: number) {}
    toDate(): Date { return new Date(this.seconds * 1000); }
}

function actAs(id: string | null, roles: string[] = ['super_admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
    ));
}

async function members(options: any = {}) {
    const mod = await import('@/app/actions/cooperative/_coop_admin_members');
    return (await mod.getStandardCooperativeMembersAction(options)) as any;
}

/**
 * Every value React would refuse to serialise, with the path it sits at.
 *
 * Plain objects, arrays, primitives, null and Date are all fine. Anything else
 * with a prototype of its own — a Timestamp, a DocumentReference, a Buffer — is
 * not, and a function anywhere is not.
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

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1');
    store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'], email: 'admin-1@example.com' });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#903 — a member whose account carries a Timestamp', () => {
    beforeEach(() => {
        //   The ACCOUNT holds the Timestamp. The member row does not, which is
        //   why serializing only the member rows was not enough.
        store.seed(COLLECTIONS.USERS, MEMBER_USER, {
            roles: ['user'],
            email: 'member@example.com',
            firstName: 'AISHAT',
            lastName: 'ABUBAKAR',
            dob: new FakeTimestamp(946_684_800, 0),
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
            userId: MEMBER_USER,
            firstName: 'AISHAT',
            lastName: 'ABUBAKAR',
            membershipStatus: 'pending',
            paymentStatus: 'pending',
            createdAt: new Date(Date.UTC(2025, 5, 1)).toISOString(),
        });
    });

    it('THE REPORTED CASE: the page load returns something React can send', async () => {
        const res = await members();

        expect(res.success).toBe(true);
        expect(unserializable(res)).toEqual([]);
    });

    it('AND THE MEMBER IS STILL THERE — this is not an empty list', async () => {
        /*
         *   The half that would make this a lockout rather than a fix. Dropping
         *   the hydration entirely would also satisfy the assertion above, and
         *   would be the same defect the owner reported: a screen that shows
         *   nothing.
         */
        const res = await members();

        expect((res.data as any[]).map((r) => r.id)).toEqual([MEMBER]);
        expect((res.data as any[])[0].user.name).toBe('AISHAT ABUBAKAR');
    });

    it('AND THE DATE SURVIVES AS A VALUE, not as a hole', async () => {
        //   serializeValue turns a Timestamp into an ISO string rather than
        //   dropping it, so the reviewer still sees the date of birth.
        const res = await members();
        const dob = (res.data as any[])[0].user.dob;

        expect(dob).toBeTruthy();
        expect(new Date(dob).getUTCFullYear()).toBe(2000);
    });

    it('AND THE GENDER SORT TOO — the second of the two loops', async () => {
        /*
         *   This action hydrates user documents TWICE, in two branches. Fixing
         *   the one a page load happens to run would be this audit's most
         *   repeated shape: a rule applied to some of the places it names.
         */
        const res = await members({ sortBy: 'gender' });

        expect(res.success).toBe(true);
        expect(unserializable(res)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#903 — and the detector is not vacuous', () => {
    it('IT CATCHES A TIMESTAMP WHEREVER IT SITS', () => {
        const ts = new FakeTimestamp(0, 0);

        expect(unserializable({ a: ts })).toEqual(['$.a (FakeTimestamp)']);
        expect(unserializable({ a: { b: [1, ts] } })).toEqual(['$.a.b[1] (FakeTimestamp)']);
        expect(unserializable({ a: () => 1 })).toEqual(['$.a (function)']);
    });

    it('AND PASSES EVERYTHING REACT ACCEPTS', () => {
        expect(unserializable({
            s: 'x', n: 1, b: true, nil: null, u: undefined,
            d: new Date(), arr: [1, 'two', { deep: null }], nested: { a: { b: 'c' } },
        })).toEqual([]);
    });
});
