/**
 * @jest-environment node
 */

/**
 *   #267 THE LIVE-CLASS JOIN LINK WENT TO ANY SIGNED-IN ACCOUNT.
 *
 *        getLiveSessionsAction returns rows carrying `customMeetingLink` — the
 *        Zoom/Meet URL an admin sets when starting a live class — and its only
 *        gate was
 *
 *            const sessionResult = await requireSession();
 *            if (!sessionResult.session?.user?.id) return Unauthorized;
 *
 *        `courseId` is OPTIONAL, so calling it with no argument at all returns
 *        every live session in the platform. Registration for the academy is
 *        free. So an account that has never paid a naira could ask for, and
 *        receive, the join link to every paid live class across every tier.
 *
 *        THE FILE'S OWN COMMENT GOT THE REASONING RIGHT AND STOPPED ONE STEP
 *        SHORT. It says, correctly, "A meeting link is a bearer credential, so
 *        this needs a session" — and a session is not entitlement. The previous
 *        pass closed "unauthenticated" and left "authenticated but has not
 *        bought this tier", which is the population that matters: anyone can
 *        become the second in about thirty seconds.
 *
 *        THE RULE ALREADY EXISTED, WITH THIS EXACT ARGUMENT WRITTEN OUT.
 *        _ac_catalog.ts's getCourseByIdAction gates paid material on
 *
 *            viewerIsAdmin || checkCourseAccess(viewerPlan, course.tier)
 *
 *        under a comment reading: "The tier gate is consulted by the enrolment
 *        action, by the course page's redirect and by the catalogue's padlock —
 *        but not here, and this is where the content is served. The redirect and
 *        the padlock were drawn after the browser already held the videos they
 *        were hiding."
 *
 *        Every word of that applies to the live sessions reader, which is also
 *        where content is served, and which was not fixed with it. The same
 *        one-rule-many-copies shape as #253, #256, #259, #260, #262, #263, #265
 *        and #266.
 *
 *        WHAT IS STRIPPED: meetingLink, customMeetingLink and recordingUrl. The
 *        row itself stays, because a learner seeing that a live class exists is
 *        the point of the schedule page — it is the padlock, not the content.
 *        Same choice stripLockedContent makes in the catalogue.
 *
 * THE SEPARATE FINDING THIS RECORDED — NOW CLOSED AS #188
 * -------------------------------------------------------
 * When a session had no customMeetingLink the learner page fell back to
 * <VideoClassroom roomName={`academy-${courseId}`} />, which loaded a PUBLIC
 * meet.jit.si room named `EasySalesExport-academy-<courseId>` with no JWT — so
 * the room went around this strip entirely: it needed no link, because the
 * browser could COMPUTE it from a course id that is on every catalogue link.
 *
 * #188 made the room name a server-minted 128-bit secret carried on the
 * session row, and this strip removes it with the rest (`delete row.roomKey`
 * below). The moderator now turns the Jitsi lobby ON, where the component used
 * to explicitly turn it off.
 *
 * What is still open, and is a hosting decision: meet.jit.si does not
 * authenticate participants, so somebody GIVEN the key can reach the lobby.
 * Only a JWT tenant binds a participant to an account. See
 * classroom-room-is-not-guessable.test.ts and CLASSROOM_JWT_IS_NOT_CONFIGURED
 * in lib/classroom-room.ts.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

jest.mock('@/lib/logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

const FREE_COURSE = 'course-free';
const STANDARD_COURSE = 'course-standard';
const ELITE_COURSE = 'course-elite';

const LINK = 'https://meet.google.com/paid-class-abc';

let store: FakeDbHandle;

const actions = async () => await import('@/app/actions/academy/_ac_live');

/** Signed in, with the academy plan the session carries (or none at all). */
function signedInAs(opts: { plan?: string | null; roles?: string[] } = {}) {
    mockRequireSession.mockResolvedValue({
        session: {
            user: {
                id: 'viewer-1',
                email: 'v@e.test',
                roles: opts.roles ?? ['general_user'],
                serviceRegistrations: opts.plan
                    ? { academy: { plan: opts.plan, status: 'approved' } }
                    : {},
            },
        },
        error: null,
    });
}

const rows = async (courseId?: string) => {
    const res = await (await actions()).getLiveSessionsAction(courseId) as any;
    expect(res.success).toBe(true);
    return res.data as any[];
};

const row = (list: any[], courseId: string) => list.find((s) => s.courseId === courseId)!;

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    store = installFakeDb();

    store.seedAll(COLLECTIONS.ACADEMY_COURSES, {
        [FREE_COURSE]: { id: FREE_COURSE, title: 'Intro to Export', tier: 'free' },
        [STANDARD_COURSE]: { id: STANDARD_COURSE, title: 'Documentation', tier: 'standard' },
        [ELITE_COURSE]: { id: ELITE_COURSE, title: 'Trade Finance', tier: 'elite' },
    });

    store.seedAll(COLLECTIONS.ACADEMY_LIVE_SESSIONS, {
        'live-free': {
            courseId: FREE_COURSE, title: 'Live: Intro', status: 'live',
            meetingLink: `/academy/live/${FREE_COURSE}`, customMeetingLink: LINK,
        },
        'live-standard': {
            courseId: STANDARD_COURSE, title: 'Live: Documentation', status: 'live',
            meetingLink: `/academy/live/${STANDARD_COURSE}`, customMeetingLink: LINK,
        },
        'live-elite': {
            courseId: ELITE_COURSE, title: 'Live: Trade Finance', status: 'ended',
            meetingLink: `/academy/live/${ELITE_COURSE}`, customMeetingLink: LINK,
            recordingUrl: 'https://videos.example/elite-week-3.mp4',
        },
    });

    signedInAs();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#267 — a free account does not receive paid join links', () => {
    it('THE WHOLE-PLATFORM CALL HANDS OUT NO PAID CREDENTIAL', async () => {
        // The defect at its widest: no courseId at all, so every live session
        // in the platform comes back. Registration is free, so this is the
        // reach of any account anybody can make.
        signedInAs({ plan: null });

        const all = await rows();

        expect(all.length).toBe(3);
        expect(row(all, STANDARD_COURSE).customMeetingLink).toBeUndefined();
        expect(row(all, ELITE_COURSE).customMeetingLink).toBeUndefined();
        expect(row(all, ELITE_COURSE).recordingUrl).toBeUndefined();
    });

    it('and the internal meeting link goes with it', async () => {
        // meetingLink is the in-app room path. Withholding one and serving the
        // other would be the padlock the catalogue comment describes: drawn
        // after the browser already holds the thing.
        signedInAs({ plan: null });

        expect(row(await rows(), STANDARD_COURSE).meetingLink).toBeUndefined();
    });

    it('BUT THE SESSION IS STILL LISTED, SO THE SCHEDULE STILL WORKS', async () => {
        // Not a deletion. A learner seeing that a live class exists is what the
        // schedule page is for — it is the padlock, not the content.
        signedInAs({ plan: null });

        const locked = row(await rows(), ELITE_COURSE);

        expect(locked.title).toBe('Live: Trade Finance');
        expect(locked.status).toBe('ended');
        expect(locked.courseId).toBe(ELITE_COURSE);
    });

    it('a free-tier course stays open to everybody, signed in with no plan', async () => {
        // Vacuity guard, and the behaviour that must not regress: a gate that
        // withheld everything would satisfy every assertion above while
        // breaking the free classes the academy uses to sell the paid ones.
        signedInAs({ plan: null });

        expect(row(await rows(), FREE_COURSE).customMeetingLink).toBe(LINK);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#267 — and the learners who paid still get in', () => {
    it('a standard plan opens standard, and not elite', async () => {
        signedInAs({ plan: 'standard' });
        const all = await rows();

        expect(row(all, STANDARD_COURSE).customMeetingLink).toBe(LINK);
        expect(row(all, ELITE_COURSE).customMeetingLink).toBeUndefined();
    });

    it('an elite plan opens every tier', async () => {
        signedInAs({ plan: 'elite' });
        const all = await rows();

        for (const c of [FREE_COURSE, STANDARD_COURSE, ELITE_COURSE]) {
            expect({ c, link: row(all, c).customMeetingLink }).toEqual({ c, link: LINK });
        }
        expect(row(all, ELITE_COURSE).recordingUrl).toBeTruthy();
    });

    it('a foundation plan opens neither of the two above it', async () => {
        signedInAs({ plan: 'foundation' });
        const all = await rows();

        expect(row(all, STANDARD_COURSE).customMeetingLink).toBeUndefined();
        expect(row(all, ELITE_COURSE).customMeetingLink).toBeUndefined();
    });

    it('an admin sees everything, because the admin console renders it', async () => {
        // /admin/academy/live/[courseId] is the screen where an admin sets the
        // link. It cannot manage a credential it is not shown.
        signedInAs({ plan: null, roles: ['academy_admin'] });
        const all = await rows();

        expect(row(all, ELITE_COURSE).customMeetingLink).toBe(LINK);
    });

    it('filtering by one course applies the same rule', async () => {
        // The per-course call is the one the learner page makes, so it must not
        // be the lenient path — that is exactly how #263 and #265 happened.
        signedInAs({ plan: null });

        const [only] = await rows(ELITE_COURSE);
        expect(only.courseId).toBe(ELITE_COURSE);
        expect(only.customMeetingLink).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#267 — the gate that was already there stays', () => {
    it('still refuses an unauthenticated caller outright', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'expired' } });

        const res = await (await actions()).getLiveSessionsAction() as any;
        expect(res.success).toBe(false);
    });

    it('a session whose course no longer exists is treated as locked', async () => {
        // Fail closed. An orphaned session is not evidence that the class was
        // free — and #245 is the case where a read failure opened a gate.
        store.seed(COLLECTIONS.ACADEMY_LIVE_SESSIONS, 'live-orphan', {
            courseId: 'deleted-course', title: 'Live: ???', status: 'live',
            customMeetingLink: LINK,
        });
        signedInAs({ plan: 'elite' });

        const orphan = row(await rows(), 'deleted-course');
        expect(orphan.customMeetingLink).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#267 — one tier rule, and the live reader uses it', () => {
    it('the live reader calls checkCourseAccess rather than rolling its own', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/academy/_ac_live.ts'), 'utf-8');

        // Not a second tier table. checkCourseAccess is the definition, and
        // ACADEMY_TIERS_OPENED beside it is the only ranking.
        expect(src).toContain('checkCourseAccess');
        expect(src).not.toContain('ACADEMY_TIERS_OPENED');
    });
});
