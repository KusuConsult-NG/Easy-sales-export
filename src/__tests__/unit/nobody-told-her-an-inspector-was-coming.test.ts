/**
 * @jest-environment node
 */

/**
 *   #862 AN INSPECTOR WAS SENT TO HER LAND AND SHE WAS NOT TOLD.
 *
 *   THE OWNER: "Inspection notification for seller when an inspector is
 *   assigned. All the details should be sent to the seller via notification or
 *   in-app messaging and it should be automatic."
 *
 *   MEASURED FIRST, and the measurement was worse than the report:
 *   `COLLECTIONS.NOTIFICATIONS` appeared in NO Farm Nation action or route.
 *   Not for a dispatch, not for a listing, not for a sale. The module told
 *   nobody anything.
 *
 *   The dispatch route is the sharpest instance. It writes the inspector's
 *   name, the scheduled date and the admin's notes onto the listing and records
 *   `inspector_dispatched` in the admin audit log — a complete account of an
 *   appointment, filed where only an administrator can read it. A stranger was
 *   going to arrive at her land on a date she had never been given.
 *
 *   And the dispatch DELISTS the parcel while it runs: `inspection_scheduled`
 *   is not in PUBLIC_LAND_STATUSES. So from the seller's side her listing left
 *   the site, silently, for a reason she had no way to learn.
 *
 * ── EXECUTED, NOT SCANNED ───────────────────────────────────────────────────
 *
 *   These run the real POST handler against the fake store. Three of the things
 *   this file pins cannot be seen in the source at all:
 *
 *     - that a REFUSED dispatch announces nothing (the notice is after the
 *       claim, so the ordering is the behaviour),
 *     - that the notice survives a dead email service — the dispatch has
 *       already happened, and turning "the email bounced" into "the dispatch
 *       failed" makes an admin dispatch again and send a SECOND inspector,
 *     - that a seller whose profile was superseded still gets it, which is what
 *       going through createNotification buys (#738) and what the first draft
 *       of the notifier lost by calling `.add()` directly.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: async () => undefined,
}));

jest.mock('next/cache', () => ({
    revalidateTag: () => undefined,
    revalidatePath: () => undefined,
    unstable_cache: (fn: any) => fn,
}));

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => undefined),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

/**
 * The CAS transition, against the store rather than against Postgres.
 *
 *   The real one is a Postgres compare-and-set function, which the fake db
 *   deliberately does not implement — see its KNOWN_DIVERGENCES. Every suite
 *   that executes one of these routes mocks it; most return a flat
 *   `{ claimed: true }`.
 *
 *   THIS ONE HONOURS THE FROM-SET, because that is what the finding turns on. A
 *   notice is sent only after a claim succeeds, so a mock that always claims
 *   would make "a refused dispatch announces nothing" pass on a route that
 *   announced everything. It reads the seeded status, applies the same
 *   allowSameStatus rule the real helper does, and writes the patch — so the
 *   409 path below is the route's own decision, not the mock's.
 */
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: async (args: any) => {
        const { supabaseDb } = await import('@/lib/supabase-db');
        const ref = supabaseDb.collection(args.collection).doc(args.id);
        const snap = await ref.get();
        if (!snap.exists) return { claimed: false, status: null, exists: false };

        const status = (snap.data() ?? {}).status ?? null;
        const from: string[] = args.allowSameStatus
            ? args.fromAny
            : args.fromAny.filter((s: string) => s !== args.to);
        if (!from.includes(status)) return { claimed: false, status, exists: true };

        await ref.update({
            ...(args.patch ?? {}),
            status: args.to,
            ...(args.recordPreviousAs ? { [args.recordPreviousAs]: status } : {}),
        });
        return { claimed: true, status, exists: true };
    },
}));

/** Every email the run attempted, and whether the service was up. */
const sent: Array<{ to: unknown; subject: string; message: string }> = [];
let emailWorks = true;

jest.mock('@/lib/email-notifications', () => ({
    canSendEmail: (_context: string, to: unknown) => typeof to === 'string' && !!to.trim(),
    getBaseUrl: () => 'https://easysalesexport.com',
    sendEmailNotification: async (data: any) => {
        sent.push(data);
        if (!emailWorks) throw new Error('Resend is down');
        return { success: true };
    },
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const OWNER = 'owner-1';
const ADMIN = 'admin-1';
const LISTINGS = COLLECTIONS.LAND_LISTINGS;
const NOTIFICATIONS = COLLECTIONS.NOTIFICATIONS;

const asAdmin = () => mockRequireSession.mockResolvedValue({
    session: { user: { id: ADMIN, email: 'admin@e.com', roles: ['farm_nation_admin'] } },
    error: null,
});

const seedListing = (over: Record<string, unknown> = {}) => {
    store.seed(LISTINGS, 'land-1', {
        id: 'land-1',
        title: '2 hectares at Ugwuoba',
        ownerId: OWNER,
        ownerName: 'Ngozi Eze',
        ownerEmail: 'ngozi@example.com',
        status: 'pending_verification',
        ...over,
    });
    store.seed(COLLECTIONS.USERS, OWNER, { email: 'ngozi@example.com', roles: ['farmer'] });
};

const dispatch = async (body: Record<string, unknown> = {}) => {
    const mod = await import('@/app/api/admin/farm-nation/dispatch-inspector/route');
    const req = new Request('http://localhost/api/admin/farm-nation/dispatch-inspector', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            verificationId: 'land-1',
            inspectorName: 'Chidi Okafor',
            scheduledDate: '2026-10-02',
            notes: 'Meet the caretaker at the gate',
            ...body,
        }),
    });
    const res = await mod.POST(req as never);
    return { status: res.status, body: await res.json() as any };
};

/** Every in-app notice written during the run. */
const notices = () => store.all(NOTIFICATIONS).map(([, d]) => d as Record<string, any>);

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    sent.length = 0;
    emailWorks = true;
    asAdmin();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#862 — the seller is told, automatically', () => {
    it('THE REPORTED GAP: a dispatch writes her an in-app notice', async () => {
        seedListing();

        const { status } = await dispatch();

        expect(status).toBe(200);
        // Was: zero. Farm Nation wrote no notification of any kind, ever.
        expect(notices()).toHaveLength(1);
        expect(notices()[0].userId).toBe(OWNER);
    });

    it('AND AN EMAIL, because a notice she has not logged in to see is not a warning', async () => {
        seedListing();

        await dispatch();

        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe('ngozi@example.com');
    });

    it('AND IT CARRIES ALL THREE DETAILS THE DISPATCH RECORDED', async () => {
        /*
         *   The half that makes it useful rather than merely present. The route
         *   records inspectorName, scheduledDate and notes; all three are what
         *   she needs in order to BE THERE, so a "an inspection has been
         *   scheduled, log in for details" would leave the defect in place.
         */
        seedListing();

        await dispatch();

        for (const channel of [notices()[0].message as string, sent[0].message]) {
            expect(channel).toContain('Chidi Okafor');
            expect(channel).toContain('2026-10-02');
            expect(channel).toContain('Meet the caretaker at the gate');
        }
    });

    it('AND POINTS AT THE LISTING IT IS ABOUT', async () => {
        seedListing();

        await dispatch();

        expect(notices()[0].link).toBe('/farm-nation/property/land-1');
        expect(sent[0].message).toContain('https://easysalesexport.com/farm-nation/property/land-1');
    });

    it('AND SAYS WHY HER LISTING HAS LEFT THE SITE', async () => {
        /*
         *   `inspection_scheduled` is not in PUBLIC_LAND_STATUSES, so the
         *   dispatch delists the parcel. Without this sentence she watches her
         *   listing disappear the same day a stranger turns up.
         */
        seedListing();

        await dispatch();

        expect(notices()[0].message).toContain('verified');
        expect(sent[0].message).toContain('accessible');
    });

    it('AND IS FILED UNDER A TYPE THE INBOX ACTUALLY HAS A TAB FOR', async () => {
        /*
         *   The first draft typed this `farm_nation_inspection_scheduled`, which
         *   is in neither Notification["type"] nor any entry of
         *   FILTER_TAB_TYPES. The row would have existed, been reachable only
         *   under "All", and never drawn the Farm Nation tab — a notice she owns
         *   and cannot find.
         */
        const { FILTER_TAB_TYPES } = await import('@/lib/notification-filter');
        seedListing();

        await dispatch();

        expect(FILTER_TAB_TYPES.farm_nation).toContain(notices()[0].type);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#862 — and only when there is something to announce', () => {
    it('A REFUSED DISPATCH ANNOUNCES NOTHING', async () => {
        /*
         *   THE ORDERING IS THE BEHAVIOUR, and it cannot be read off the source.
         *   The notice sits after the claimed transition; a listing in escrow is
         *   not dispatchable, so the route returns 409 and she is told about no
         *   appointment that is not happening.
         */
        seedListing({ status: 'pending_escrow' });

        const { status } = await dispatch();

        expect(status).toBe(409);
        expect(notices()).toHaveLength(0);
        expect(sent).toHaveLength(0);
    });

    it('AND A MISSING LISTING ANNOUNCES NOTHING', async () => {
        const { status } = await dispatch({ verificationId: 'no-such-land' });

        expect(status).toBe(404);
        expect(notices()).toHaveLength(0);
    });

    it('AND A CALLER WITHOUT THE PERMISSION GETS NEITHER', async () => {
        seedListing();
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'u-9', email: 'u9@e.com', roles: ['general_user'] } },
            error: null,
        });

        const { status } = await dispatch();

        expect(status).toBe(403);
        expect(notices()).toHaveLength(0);
        expect(sent).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#862 — and telling her can never undo the dispatch', () => {
    it('A DEAD EMAIL SERVICE DOES NOT FAIL THE DISPATCH', async () => {
        /*
         *   The rule this file exists to protect. By the time the notice runs,
         *   the inspector IS dispatched. A throw here returns 500, the admin
         *   presses the button again, and a second inspector is sent to her
         *   land.
         */
        seedListing();
        emailWorks = false;

        const { status, body } = await dispatch();

        expect({ status, success: body.success }).toEqual({ status: 200, success: true });
        expect(store.get(LISTINGS, 'land-1')!.status).toBe('inspection_scheduled');
        // And the bell still rang — it is the channel that does not need Resend.
        expect(notices()).toHaveLength(1);
    });

    it('AND A LISTING WITH NO ADDRESS ON IT STILL GETS THE BELL', async () => {
        seedListing({ ownerEmail: undefined });

        const { status } = await dispatch();

        expect(status).toBe(200);
        expect(notices()).toHaveLength(1);
        // Read off the user record, which is where nine callers' addresses live.
        expect(sent[0]?.to).toBe('ngozi@example.com');
    });

    it('AND A LISTING WITH NO OWNER AT ALL DOES NOT THROW', async () => {
        //   A notification row with no userId is one nobody can ever read, so
        //   none is written — but the dispatch itself must still complete.
        seedListing({ ownerId: undefined, ownerEmail: undefined });

        const { status } = await dispatch();

        expect(status).toBe(200);
        expect(notices()).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#862 — and there is one rule for where to send a notice, not three', () => {
    /*
     *   Writing this notifier meant writing a THIRD private `resolveEmail`:
     *   loan-decision-notice and member-decision-notice each held one, identical
     *   but for the log prefix. Two copies of a rule is how this audit's most
     *   common defect starts — a correct rule applied to SOME of the places it
     *   names — so the copies were extracted rather than added to.
     *
     *   Read from source because it is a fact about the tree, not about a run.
     */
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const { stripComments } = require('@/lib/testing/strip-comments') as
        typeof import('@/lib/testing/strip-comments');

    const NOTIFIERS = [
        'src/lib/loan-decision-notice.ts',
        'src/lib/member-decision-notice.ts',
        'src/lib/farm-nation-notifications.ts',
    ];
    const read = (rel: string) =>
        stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

    it('NO NOTIFIER DEFINES ITS OWN', () => {
        const offenders = NOTIFIERS.filter((f) => /function resolveEmail\b/.test(read(f)));
        expect(offenders).toEqual([]);
    });

    it('AND ALL THREE USE THE SHARED ONE', () => {
        const missing = NOTIFIERS.filter((f) => !read(f).includes('resolveNoticeEmail('));
        expect(missing).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#862 — and it reaches the profile she signs in as', () => {
    it('A SUPERSEDED OWNER IS FOLLOWED TO HER LIVE ROW', async () => {
        /*
         *   #738's rule, inherited rather than re-implemented. The first draft
         *   of the notifier wrote `db.collection(NOTIFICATIONS).add(...)`
         *   directly — the same shortcut five other writers took (#687) — which
         *   skips it: the notice would have landed on a profile she no longer
         *   signs into, and the platform would have recorded her as told.
         *
         *   This is the test that fails if anybody ever swaps
         *   createNotification back out for a raw write.
         */
        seedListing();
        store.seed(COLLECTIONS.USERS, OWNER, {
            email: 'ngozi@example.com', _migratedTo: 'owner-live',
        });
        store.seed(COLLECTIONS.USERS, 'owner-live', { email: 'ngozi@example.com' });

        await dispatch();

        expect(notices()[0].userId).toBe('owner-live');
    });
});
