/**
 * @jest-environment node
 */

/**
 * Four modules that decide who sees what, and no test had named any of them.
 *
 *   From the same count: 1,272 shipping files, 137 mentioned by no test. Each
 *   of these four is a rule EXTRACTED so that several callers could share it —
 *   which is this codebase's answer to its most repeated defect — and every one
 *   of them was then left with no check of its own.
 *
 *   One of the four was also wrong.
 *
 * ── lib/wave-resource-access — THE ADMIN BRANCH ASKED THE TOKEN ─────────────
 *
 *   `isAdmin(roles)`, with both call sites passing `session.user.roles`. That
 *   is #356's class: a JWT role claim keeps its value for up to eight hours
 *   after the database loses it, so a revoked admin went on reading the
 *   members' library and bumping download counters for the rest of their
 *   session.
 *
 *   What made it worth fixing rather than recording is that the live read was
 *   ALREADY HAPPENING three lines below — the Academy branch fetches the user
 *   document anyway. The token was being trusted beside a row that held the
 *   answer.
 *
 * ── AND THE OTHER THREE ARE RIGHT, WHICH IS ALSO WORTH PINNING ──────────────
 *
 *   Each one fails in a chosen direction, and the direction is the whole
 *   design: a purchase read fails CLOSED (it widens who sees paid content), a
 *   bounce check fails OPEN (a database hiccup must not silence every
 *   transactional email), and an address lookup returns nothing rather than
 *   throwing (every caller is past the point of no return). Those are exactly
 *   the properties a later edit erases without noticing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { canAccessWaveResources } from '@/lib/wave-resource-access';
import { purchasedCourseIds, hasPurchasedCourse } from '@/lib/academy-purchased-courses';
import { isUndeliverable, bouncedDocIds } from '@/lib/bounced-address';
import { resolveNoticeEmail } from '@/lib/notice-email-address';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const MEMBER = 'member-1';

// ─────────────────────────────────────────────────────────────────────────────
describe('who may read the WAVE resource library', () => {
    it('AN ACTIVE MEMBER MAY', async () => {
        store.seed(COLLECTIONS.WAVE_MEMBERS, MEMBER, { active: true });

        expect(await canAccessWaveResources(MEMBER, [])).toBe(true);
    });

    it('AND A MEMBER WHOSE MEMBERSHIP IS NOT ACTIVE MAY NOT', async () => {
        store.seed(COLLECTIONS.WAVE_MEMBERS, MEMBER, { active: false });
        store.seed(COLLECTIONS.USERS, MEMBER, { roles: ['general_user'] });

        expect(await canAccessWaveResources(MEMBER, [])).toBe(false);
    });

    it('AN ADMIN MAY — read from the ROW, not from the token', async () => {
        //   THE fix. The row says admin, so access is granted.
        store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'] });

        expect(await canAccessWaveResources('admin-1', [])).toBe(true);
    });

    it('AND A REVOKED ADMIN MAY NOT, however their token still reads', async () => {
        /*
         *   #356, on this gate. The session claim is up to eight hours old;
         *   the row is the fact. Passing the old claim in — which is exactly
         *   what both call sites do — must not open the library.
         */
        store.seed(COLLECTIONS.USERS, 'ex-admin', { roles: ['general_user'] });

        expect(await canAccessWaveResources('ex-admin', ['super_admin', 'admin'])).toBe(false);
    });

    it('AN ACADEMY ELITE MEMBER MAY, approved or active', async () => {
        for (const status of ['approved', 'active']) {
            store.seed(COLLECTIONS.USERS, 'elite', {
                roles: ['general_user'],
                serviceRegistrations: { academy: { plan: 'elite', status } },
            });
            expect({ status, allowed: await canAccessWaveResources('elite', []) })
                .toEqual({ status, allowed: true });
        }
    });

    it('AND A LESSER PLAN OR A PENDING ONE MAY NOT (control)', async () => {
        //   The vacuity guard: a gate that admitted everybody would satisfy
        //   every "may" above.
        store.seed(COLLECTIONS.USERS, 'basic', {
            roles: ['general_user'],
            serviceRegistrations: { academy: { plan: 'basic', status: 'approved' } },
        });
        expect(await canAccessWaveResources('basic', [])).toBe(false);

        store.seed(COLLECTIONS.USERS, 'pending', {
            roles: ['general_user'],
            serviceRegistrations: { academy: { plan: 'elite', status: 'pending' } },
        });
        expect(await canAccessWaveResources('pending', [])).toBe(false);
    });

    it('AND SOMEBODY WITH NO ROW AT ALL MAY NOT', async () => {
        expect(await canAccessWaveResources('nobody', ['super_admin'])).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('which courses a learner bought outright', () => {
    //   The progress row lives at `user_progress/{userId}/courses/{courseId}`
    //   — a subcollection, which this harness flattens to the path before the
    //   last segment. See lib/academy-course-progress.userProgressPath.
    const buy = (userId: string, courseId: string, purchased: boolean) =>
        store.seed(`user_progress/${userId}/courses`, courseId, { purchased });

    it('IT FINDS THE ONES THEY BOUGHT AND NOT THE ONES THEY DID NOT', async () => {
        buy('learner', 'course-a', true);
        buy('learner', 'course-b', false);

        const bought = await purchasedCourseIds('learner', ['course-a', 'course-b', 'course-c']);

        expect([...bought]).toEqual(['course-a']);
    });

    it('AND ONE READ PER DISTINCT COURSE, not per row', async () => {
        //   The callers are listing pages, where the same course appears
        //   several times. A read per occurrence is an N+1 in a loop.
        buy('learner', 'course-a', true);
        store.reads.length = 0;

        await purchasedCourseIds('learner', ['course-a', 'course-a', 'course-a', '', null]);

        expect(store.reads.length).toBe(1);
    });

    it('AND AN ANONYMOUS CALLER HAS BOUGHT NOTHING, without a read', async () => {
        store.reads.length = 0;

        expect([...await purchasedCourseIds(null, ['course-a'])]).toEqual([]);
        expect([...await purchasedCourseIds('', ['course-a'])]).toEqual([]);
        expect(store.reads.length).toBe(0);
    });

    it('AND hasPurchasedCourse ANSWERS THE SINGLE CASE', async () => {
        buy('learner', 'course-a', true);

        expect(await hasPurchasedCourse('learner', 'course-a')).toBe(true);
        expect(await hasPurchasedCourse('learner', 'course-b')).toBe(false);
        expect(await hasPurchasedCourse('learner', null)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('an address that refused mail', () => {
    it('BOTH SPELLINGS THE WEBHOOK MAY HAVE WRITTEN', () => {
        //   It stores under `toLowerCase().replace(/\//g, "_")`, because a
        //   slash is not legal in a document id. Checking one would miss every
        //   address written under the other.
        expect(bouncedDocIds('Bola@Example.com')).toEqual(['bola@example.com']);
        expect(bouncedDocIds('a/b@example.com'))
            .toEqual(['a/b@example.com', 'a_b@example.com']);
        expect(bouncedDocIds('')).toEqual([]);
    });

    it('A RECORDED BOUNCE IS UNDELIVERABLE', async () => {
        store.seed(COLLECTIONS.BOUNCED_EMAILS, 'bola@example.com', { reason: 'email.bounced' });

        expect(await isUndeliverable('Bola@Example.com')).toBe(true);
    });

    it('AND A COMPLAINT IS NOT — a bounce and a complaint are different facts', async () => {
        /*
         *   The broadcast excludes on either, and for bulk mail that is right.
         *   A complaint means the message ARRIVED and was unwanted; their bank
         *   details being wrong is still theirs to hear about.
         */
        store.seed(COLLECTIONS.BOUNCED_EMAILS, 'cross@example.com', { reason: 'email.complained' });

        expect(await isUndeliverable('cross@example.com')).toBe(false);
    });

    it('AND AN ADDRESS NOBODY RECORDED IS DELIVERABLE', async () => {
        expect(await isUndeliverable('new@example.com')).toBe(false);
        expect(await isUndeliverable('')).toBe(false);
        expect(await isUndeliverable(undefined)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('where to send a notice', () => {
    it('AN ADDRESS THE CALLER HOLDS WINS, without a read', async () => {
        //   It came off the record the notice is about — a loan, a listing —
        //   and is what that transaction was agreed with.
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'row@example.com' });
        store.reads.length = 0;

        expect(await resolveNoticeEmail('test', 'u1', 'given@example.com')).toBe('given@example.com');
        expect(store.reads.length).toBe(0);
    });

    it('AND OTHERWISE THE USER ROW ANSWERS', async () => {
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'row@example.com' });

        expect(await resolveNoticeEmail('test', 'u1')).toBe('row@example.com');
        expect(await resolveNoticeEmail('test', 'u1', '   ')).toBe('row@example.com');
    });

    it('AND A MISSING ROW OR A BLANK ADDRESS RETURNS NOTHING, never throws', async () => {
        //   Every caller is past the point of no return by the time it asks —
        //   the decision is committed — so "we could not find an address" must
        //   never become "the operation failed".
        store.seed(COLLECTIONS.USERS, 'blank', { email: '   ' });

        expect(await resolveNoticeEmail('test', 'missing')).toBeUndefined();
        expect(await resolveNoticeEmail('test', 'blank')).toBeUndefined();
        expect(await resolveNoticeEmail('test', '')).toBeUndefined();
    });
});
