/**
 *   THE OWNER: "fix the cooperative one next."
 *
 *   Their log, one session — and the slowest of the six by a clear margin:
 *
 *       checkCooperativeStatusAction took 1840ms
 *       checkCooperativeStatusAction took 2075ms
 *       checkCooperativeStatusAction took 1928ms
 *       checkCooperativeStatusAction took 1720ms
 *
 * ── MEASURED, NOT GUESSED ───────────────────────────────────────────────────
 *
 *   #261's read meter with a real per-request memoiser — React's cache() is a
 *   PASS-THROUGH under jest, so a suite that skips that step measures a
 *   platform with no request memoisation at all. A member with nothing filed:
 *
 *       checkCooperativeStatusAction    8 reads → 7
 *       a cooperatives page draw       14 reads → 10 → 7
 *
 *   FOURTEEN was the highest count this audit has measured anywhere, and
 *   THREE of them were the same user row: the module gate read it, the status
 *   action read it again, and the member lookup's identity walk read it a
 *   third time.
 *
 *   TWO CHANGES.
 *
 *   1. The action reads the row through the request memo, so the gate above
 *      it and the action share one read.
 *
 *   2. `findCooperativeMemberRowForPerson` takes the row when the caller
 *      already holds it. `ownedProfileIdsFor` is `liveProfileId` composed with
 *      `ownedProfileIds`, and its own header says the forward walk costs "ONE
 *      EXTRA KEYED READ ... a live id resolves to itself on the first hop" —
 *      that hop reads the row the caller is holding. The same change lets the
 *      action share the backward identity search with the gate, which was
 *      being paid TWICE because the two used different cache() entry points.
 *
 *   THE WALK IS KEPT FOR THE CALLERS THAT NEED IT. `membershipRefForPayment`
 *   and `cooperativeTierForPerson` are handed an id that may not be the
 *   caller's own — a membership id out of payment metadata, an admin looking
 *   at somebody else. They pass no row and resolve exactly as before.
 *
 * ── AND THEN THE OTHER THREE ────────────────────────────────────────────────
 *
 *   THE OWNER: "fix the remaining three cooperative reads next."
 *
 *   The first pass stopped at ten with those three named. They were not memo
 *   problems, they were SHAPE problems — two callers asking one question two
 *   ways cannot share an answer:
 *
 *       cooperative_members:doc     `.doc(userId)` — identical; memoised
 *       cooperative_members:query   `userId IN <owned>` vs `userId == <id>`
 *       cooperative_members:query   the email queries, LIMIT 1 vs SCAN_LIMIT
 *
 *   In both disagreements the shape kept is the GATE's, because the gate is
 *   what decides module access and its bound is the one this codebase already
 *   reasoned about. The lookup's per-id `userId == <id> LIMIT 1` loop — one
 *   query per owned profile — is gone; it asks the gate's owner-scoped
 *   question once and narrows in memory, preserving the precedence the loop
 *   had exactly.
 *
 *   The email disagreement was a defect before it was a cost, the same one
 *   Export had: with more than one membership at an address, the gate took
 *   the LATEST and the action took whichever row LIMIT 1 returned.
 *
 *   THE PAGE NOW COSTS WHAT THE ACTION COSTS. The gate above it adds nothing:
 *
 *       a cooperatives page draw       14 reads → 7
 *
 *   WHICH IS ONLY SAFE BECAUSE THE HEALS DROP THE MEMOS. Both the gate and
 *   the action write to this collection — a missing `userId`, a
 *   membershipStatus payment has overtaken — and all four call sites call
 *   `forgetCooperativeMemberReads` first. Without that a reader later in the
 *   same request is handed the rows as they were before the heal, which is
 *   #692 in a third collection.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('react', () => {
    const actual: any = jest.requireActual('react');
    return {
        ...actual,
        cache: (fn: any) => {
            const memo = new Map<string, any>();
            return (...args: any[]) => {
                const key = JSON.stringify(args);
                if (!memo.has(key)) memo.set(key, fn(...args));
                return memo.get(key);
            };
        },
    };
});

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const UID = 'member-1';
const EMAIL = 'member@example.test';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;

/** Today's cost of the cooperatives screens a member actually waits on. */
const CEILING = { action: 7, page: 7 };

let store: FakeDbHandle;

const sessionAs = (id: string, email: string) => {
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id, email, roles: ['general_user'] } },
        error: null,
    }));
};

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user'],
        isVerified: true, profileComplete: true, serviceRegistrations: {},
    });
    sessionAs(UID, EMAIL);
});

const coop = () => import('@/app/actions/cooperative/_coop_membership');
const ownRowReads = () =>
    store.reads.filter((r: any) => r.collection === COLLECTIONS.USERS && r.id === UID).length;

describe('what a cooperatives page draw costs a member with nothing filed', () => {
    it('DOES NOT GROW — seven reads is the action\'s ceiling, down from eight', async () => {
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        const result = await checkCooperativeStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.action);
        //   AND THE ANSWER IS UNCHANGED, which is what makes the saving free.
        expect(result).toBeNull();
    });

    it('reads the caller\'s own row ONCE inside the action, not twice', async () => {
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        await checkCooperativeStatusAction();

        expect(ownRowReads()).toBe(1);
    });

    it('DOES NOT GROW — seven reads is the page\'s ceiling, down from fourteen', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'cooperatives');
        await checkCooperativeStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.page);
    });

    it('and the gate and the action share ONE read of that row, not three', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'cooperatives');
        await checkCooperativeStatusAction();

        expect(ownRowReads()).toBe(1);
    });
});

describe('the gate above the screen adds nothing to it', () => {
    const readsOf = (collection: string) =>
        store.reads.filter((r: any) => r.collection === collection);

    it('asks cooperative_members for the SAME ROW once, not twice', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'cooperatives');
        await checkCooperativeStatusAction();

        const keyed = readsOf(MEMBERS).filter((r: any) => r.id === UID);
        expect(keyed.length).toBe(1);
    });

    it('and issues each of its two QUERIES once, not once per caller', async () => {
        //   The owner-scoped one and the by-email one. Before this they were
        //   four queries: two shapes, two callers, no sharing possible.
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'cooperatives');
        await checkCooperativeStatusAction();

        const queries = readsOf(MEMBERS).filter((r: any) => !r.id);
        expect(queries.length).toBe(2);
    });

    it('THE PAGE COSTS WHAT THE ACTION COSTS — the gate is free', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkCooperativeStatusAction } = await coop();

        store.reads.length = 0;
        await checkCooperativeStatusAction();
        const actionAlone = store.reads.length;

        jest.resetModules();
        store.reads.length = 0;
        const gate = (await import('@/lib/module-access-check')).checkModuleAccess;
        const check = (await coop()).checkCooperativeStatusAction;
        await gate(UID, ['general_user'] as never, 'cooperatives');
        await check();

        expect(store.reads.length).toBe(actionAlone);
        void checkModuleAccess;
    });
});

describe('#692 — a heal is visible to everything after it', () => {
    it('THE SHARED READERS ARE DROPPED BY THE WRITE THAT CHANGES THEM', async () => {
        /*
         *   This is the whole licence for memoising a collection that BOTH the
         *   gate and the status action heal. If a heal does not drop the
         *   memos, a reader later in the same request is handed the rows as
         *   they were before the grant — and on this collection the grant is
         *   the cooperative_member role.
         */
        store.seed(MEMBERS, 'coop-row', { email: EMAIL, membershipStatus: 'active' });

        const {
            membersOwnedByOnce, forgetCooperativeMemberReads,
        } = await import('@/lib/cooperative-member-lookup');
        const { supabaseDb } = await import('@/lib/supabase-db');
        const members = supabaseDb.collection(MEMBERS);

        const before = await membersOwnedByOnce(members, [UID]);
        expect(before.empty).toBe(true);

        //   The heal: the row is claimed for this member.
        forgetCooperativeMemberReads();
        await members.doc('coop-row').update({ userId: UID });

        const after = await membersOwnedByOnce(members, [UID]);
        expect(after.empty).toBe(false);
    });

    it('DOES NOT REMEMBER A FAILURE — one bad read is not the rest of the request', async () => {
        //   This feeds a module gate, so a remembered rejection turns one
        //   transient error into "not a member" for every later caller.
        const { memberDocOnce } = await import('@/lib/cooperative-member-lookup');
        const { supabaseDb } = await import('@/lib/supabase-db');

        //   The shape a real PostgREST failure takes: the call returns, the
        //   promise rejects.
        const failsLate = { doc: () => ({ get: async () => { throw new Error('PostgREST said no'); } }) };
        await expect(memberDocOnce(failsLate as any, UID)).rejects.toThrow('PostgREST said no');

        await expect(memberDocOnce(supabaseDb.collection(MEMBERS), UID))
            .resolves.toMatchObject({ exists: false });
    });

    it('AND A SYNCHRONOUS THROW IS STILL A REJECTED PROMISE', async () => {
        /*
         *   `.doc(id)` and `filterByOwner` are ordinary calls and can throw
         *   where they stand — a bad argument, a handle that is not there.
         *   Caught by this test: the throw escaped `once` synchronously, so
         *   one caller got an exception and the next got a promise for the
         *   same question. Callers should not have to handle a read two ways.
         */
        const { memberDocOnce } = await import('@/lib/cooperative-member-lookup');
        const failsEarly = { doc: () => { throw new Error('no such handle'); } };

        await expect(memberDocOnce(failsEarly as any, UID)).rejects.toThrow('no such handle');
    });
});

describe('the precedence the per-id loop had is the precedence it kept', () => {
    it('A ROW KEYED BY THE ID BEATS A ROW MERELY CARRYING IT', async () => {
        /*
         *   The old loop asked `.doc(id)` and only then `userId == id`, per
         *   owned profile. Replacing the second half with one owner-scoped
         *   query is only safe if the ORDER survives — and read counts cannot
         *   see the order, because both reads are memoised either way.
         *
         *   #488's note is why the two differ at all: a legacy import keys the
         *   row by the member's id and leaves the `userId` FIELD empty, which
         *   is the row the heal exists to repair. Picking the other one first
         *   would heal the wrong document.
         */
        store.seed(MEMBERS, UID, { membershipStatus: 'active', totalContributions: 1 });
        store.seed(MEMBERS, 'another-row', { userId: UID, membershipStatus: 'pending' });

        const { findCooperativeMemberRowForPerson } = await import('@/lib/cooperative-member-lookup');
        const { supabaseDb } = await import('@/lib/supabase-db');

        const row = await findCooperativeMemberRowForPerson(
            supabaseDb.collection(MEMBERS), UID, store.get(COLLECTIONS.USERS, UID) as any);

        expect(row?.id).toBe(UID);
    });
});

describe('every write to this collection drops the memos first', () => {
    it('IN BOTH FILES THAT HEAL IT', () => {
        /*
         *   Read from the source because driving all four heal paths needs
         *   four fixtures, and the property worth holding is not "this one
         *   forgets" but "none of them forgets" — which is a statement about
         *   the files.
         *
         *   Caught by mutation: a test that called forgetCooperativeMemberReads
         *   ITSELF and then re-read was green with the call deleted from BOTH
         *   production heal sites. It was pinning the helper, not the callers.
         *
         *   Anchored to the start of a statement, not matched anywhere: a bare
         *   grep counts the text inside a comment too, which is how #268's
         *   ratchet survived being commented out.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        for (const [rel, writes] of [
            ['src/lib/module-access-check.ts', 2],
            ['src/app/actions/cooperative/_coop_membership.ts', 2],
        ] as const) {
            const source = readFileSync(join(process.cwd(), rel), 'utf8');

            const healWrites = [...source.matchAll(
                /^\s*await (?:memberRef|db\.collection\(COLLECTIONS\.COOPERATIVE_MEMBERS\)\.doc\([^)]*\))\.update\(/gm)];
            const forgets = [...source.matchAll(/^\s*forgetCooperativeMemberReads\(\);/gm)];

            expect({ rel, writes: healWrites.length }).toEqual({ rel, writes });
            expect({ rel, forgets: forgets.length }).toEqual({ rel, forgets: writes });
        }
    });
});

describe('the widened email scan did not widen what may be claimed', () => {
    it('STILL REFUSES a membership that belongs to somebody else', async () => {
        //   The query reads 25 rows where it read one, and the claim gate is
        //   unchanged: a row tied to another account is not adopted, and the
        //   cooperative_member role is not granted on it.
        store.seed(MEMBERS, 'theirs', {
            userId: 'somebody-else', email: EMAIL,
            membershipStatus: 'active', onboardingCompleted: true, paymentStatus: 'completed',
        });
        const { checkCooperativeStatusAction } = await coop();

        const result = await checkCooperativeStatusAction();

        expect(result).toBeNull();
        expect((store.get(MEMBERS, 'theirs') as any)?.userId).toBe('somebody-else');
        const me: any = store.get(COLLECTIONS.USERS, UID);
        expect(me?.roles ?? []).not.toContain('cooperative_member');
    });
});

describe('the identity walk is narrowed, not deleted', () => {
    it('STILL FINDS a membership filed under a superseded profile', async () => {
        //   #816's case: the row sits under a profile the member no longer
        //   signs in as, and #490 signs them in as the row that won.
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(MEMBERS, 'old-id', {
            userId: 'old-id', membershipStatus: 'active', onboardingCompleted: true,
            paymentStatus: 'completed',
        });
        const { checkCooperativeStatusAction } = await coop();

        const result = await checkCooperativeStatusAction();

        expect(result).toBe('active');
    });

    it('AND THE CALLERS THAT PASS NO ROW STILL WALK FORWARD', async () => {
        /*
         *   membershipRefForPayment and cooperativeTierForPerson are handed an
         *   id that may not be the caller's own. They omit the row, and must
         *   still resolve a SUPERSEDED id forward to the row that won — which
         *   the narrowed branch cannot do and is not asked to.
         */
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(MEMBERS, UID, { userId: UID, totalContributions: 50000 });

        const { findCooperativeMemberRowForPerson } = await import('@/lib/cooperative-member-lookup');

        //   Asked about the id that LOST, with no row in hand.
        const row = await findCooperativeMemberRowForPerson(
            (await import('@/lib/supabase-db')).supabaseDb.collection(MEMBERS), 'old-id');

        expect(row?.id).toBe(UID);
    });

    it('and a row that is MISSING is not mistaken for a live one', async () => {
        //   `isLiveUserRow(id, null)` is false, so a caller that passes null
        //   gets the walk — the conservative branch, not the cheap one.
        const { findCooperativeMemberRowForPerson } = await import('@/lib/cooperative-member-lookup');
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(MEMBERS, UID, { userId: UID });

        const row = await findCooperativeMemberRowForPerson(
            (await import('@/lib/supabase-db')).supabaseDb.collection(MEMBERS), 'old-id', null);

        expect(row?.id).toBe(UID);
    });
});
