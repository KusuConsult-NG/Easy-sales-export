/**
 * @jest-environment node
 */

/**
 *   #188 THE IN-APP CLASSROOM WAS A PUBLIC ROOM WITH A GUESSABLE NAME.
 *
 *        VideoClassroom opens a room on meet.jit.si — a public instance with no
 *        JWT — and the room name was computed IN THE BROWSER from an identifier
 *        that is on every URL of the platform:
 *
 *          /academy/live/[courseId]            `academy-${courseId}`
 *          /admin/academy/live/[courseId]      `academy-${courseId}`
 *          /admin/wave/training/live/[eventId] `wave-training-${eventId}`
 *
 *        and the component prefixed `EasySalesExport-`. So the room for any
 *        paid live class was `EasySalesExport-academy-<courseId>`, and the
 *        course id is in the catalogue link. Anybody who had seen a course page
 *        could type that into meet.jit.si and be in the class WITH NO ACCOUNT.
 *
 *        #267 had already established that a meeting link is a bearer
 *        credential and stripped meetingLink, customMeetingLink and
 *        recordingUrl from an un-entitled learner's copy of the row. The
 *        built-in classroom went around that entirely — it needed no link,
 *        because the browser could compute the room.
 *
 *   THE DECISION, AND WHAT IT DOES AND DOES NOT CLOSE
 *
 *        The recorded finding called this a hosting decision: JaaS, or a
 *        moderator lobby. Half of it is. The other half is not, and it is the
 *        half that was broken.
 *
 *          THE ROOM NAME IS A SERVER-MINTED 128-BIT SECRET, stored on the
 *          live-session row and handed out only through the reader that
 *          already applies the entitlement check.
 *
 *          THE MODERATOR TURNS THE LOBBY ON. The component did the opposite,
 *          and nothing ever turned it on.
 *
 *        WHAT REMAINS OPEN, STATED PLAINLY IN THE CODE AND HERE: meet.jit.si
 *        does not authenticate participants, so somebody GIVEN the key can
 *        still reach the lobby. Only a JWT tenant fixes that, and that is a
 *        hosting and cost decision.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    CLASSROOM_ROOM_PREFIX,
    CLASSROOM_ROOM_KEY_BYTES,
    RETIRED_ROOM_NAME_EXPRESSIONS,
    classroomRoomName,
    isMintedRoomKey,
} from '@/lib/classroom-room';
import { mintClassroomRoomKey, roomKeyFor } from '@/lib/classroom-room-key';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
    isAdmin: (roles: string[]) => jest.requireActual<any>('@/lib/admin-permissions').isAdmin(roles),
}));

jest.mock('@/lib/logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

/**
 * The CAS claim is a Postgres function; the fake store cannot run it. It is
 * mocked to succeed so the minting AFTER it can be driven — the claim's own
 * behaviour is #143's suite, not this one.
 */
const mockClaim = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (...a: any[]) => mockClaim(...a),
}));

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(),
    recordAdminAction: jest.fn(),
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

const RULE = 'src/lib/classroom-room.ts';
const MINT = 'src/lib/classroom-room-key.ts';
const COMPONENT = 'src/components/VideoClassroom.tsx';
const ACADEMY_ACTIONS = 'src/app/actions/academy/_ac_live.ts';
const WAVE_ACTIONS = 'src/app/actions/wave/_wv_admin_live.ts';
const WAVE_API = 'src/app/api/wave/training-sessions/route.ts';

/** Every screen that opens a classroom. */
const CLASSROOM_PAGES = [
    'src/app/academy/live/[courseId]/page.tsx',
    'src/app/admin/academy/live/[courseId]/page.tsx',
    'src/app/admin/wave/training/live/[eventId]/page.tsx',
    'src/app/wave/(member)/live-training/page.tsx',
];

const FREE_COURSE = 'course-free';
const PAID_COURSE = 'course-elite';

let store: FakeDbHandle;

function source(rel: string): string {
    const full = join(ROOT, rel);
    // A missing file would slice every sweep below to nothing and let each
    // assertion pass vacuously.
    expect(existsSync(full)).toBe(true);
    return stripComments(readFileSync(full, 'utf-8'), { label: rel });
}

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

const academy = async () => await import('@/app/actions/academy/_ac_live');

/** The documents of a collection. store.all() yields [id, doc] pairs. */
const docs = (collection: string) => store.all(collection).map(([, d]) => d);

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockClaim.mockResolvedValue({ claimed: true, status: 'ongoing' });
    store.seedAll(COLLECTIONS.ACADEMY_COURSES, {
        [FREE_COURSE]: { id: FREE_COURSE, title: 'Intro', tier: 'free' },
        [PAID_COURSE]: { id: PAID_COURSE, title: 'Trade Finance', tier: 'elite' },
    });
    signedInAs();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#188 — what may name a classroom', () => {
    it('THE CHECK IS THE MINTED SHAPE, so every derived name fails by construction', () => {
        // Not an exclusion list. A list of forbidden prefixes would have to
        // grow every time a caller invents a fifth naming scheme, and the one
        // that got forgotten would be the one that shipped.
        for (const derived of [
            'academy-course-123',
            'wave-training-evt-9',
            'EasySalesExport-academy-course-123',
            'course-free',
            '',
            'ACADEMY-COURSE',
            'not-hex-at-all-not-hex-at-all-xx',
        ]) {
            expect(isMintedRoomKey(derived)).toBe(false);
        }
        expect(isMintedRoomKey(null)).toBe(false);
        expect(isMintedRoomKey(undefined)).toBe(false);
        expect(isMintedRoomKey(12345)).toBe(false);
    });

    it('a real minted key passes, and only at the exact length', () => {
        const key = mintClassroomRoomKey();
        expect(isMintedRoomKey(key)).toBe(true);
        expect(key).toMatch(/^[0-9a-f]{32}$/);

        // One character short or long is not a key.
        expect(isMintedRoomKey(key.slice(0, 31))).toBe(false);
        expect(isMintedRoomKey(key + 'a')).toBe(false);
        // Nor is it with anything appended.
        expect(isMintedRoomKey(`${key}-academy`)).toBe(false);
    });

    it('THE KEY IS 128 BITS, so guessing it is guessing a 128-bit number', () => {
        expect(CLASSROOM_ROOM_KEY_BYTES).toBeGreaterThanOrEqual(16);
        expect(mintClassroomRoomKey()).toHaveLength(CLASSROOM_ROOM_KEY_BYTES * 2);
    });

    it('two mints are never the same key', () => {
        const keys = new Set(Array.from({ length: 200 }, () => mintClassroomRoomKey()));
        expect(keys.size).toBe(200);
    });

    it('the room name is the namespace plus the secret, and NULL for anything else', () => {
        const key = mintClassroomRoomKey();
        expect(classroomRoomName(key)).toBe(`${CLASSROOM_ROOM_PREFIX}-${key}`);

        // Returning null rather than a fallback is the point: the made-up
        // fallback name IS the defect.
        expect(classroomRoomName('academy-course-123')).toBeNull();
        expect(classroomRoomName('')).toBeNull();
        expect(classroomRoomName(null)).toBeNull();
    });

    it('an existing minted key is KEPT, so re-starting does not eject the room', () => {
        const key = mintClassroomRoomKey();
        expect(roomKeyFor(key)).toBe(key);
    });

    it('a derived name, or none at all, is REPLACED with a real key', () => {
        for (const legacy of [null, undefined, '', 'academy-course-123', 'wave-training-evt-1']) {
            const replacement = roomKeyFor(legacy);
            expect(isMintedRoomKey(replacement)).toBe(true);
            expect(replacement).not.toBe(legacy);
        }
    });

    it('the rule module imports NOTHING, so mocking a database cannot break it', () => {
        expect(source(RULE)).not.toMatch(/^\s*import\s/m);
    });

    it('MINTING IS SERVER-ONLY — the rule module cannot generate a key', () => {
        // A key generated in the browser would put the secret in the one place
        // the person it is meant to keep out is sitting.
        expect(source(RULE)).not.toContain('randomBytes');
        expect(source(MINT)).toContain('crypto.randomBytes');
        expect(source(MINT)).toContain('from "crypto"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#188 — the academy classroom is minted and gated', () => {
    it('STARTING A CLASS MINTS A KEY', async () => {
        signedInAs({ roles: ['academy_admin'] });

        const res = await (await academy()).startAcademyLiveSessionAction(FREE_COURSE) as any;
        expect(res.success).toBe(true);

        const rows = docs(COLLECTIONS.ACADEMY_LIVE_SESSIONS);
        expect(rows).toHaveLength(1);
        expect(isMintedRoomKey(rows[0].roomKey)).toBe(true);
    });

    it('the key is NOT derived from the course id', async () => {
        signedInAs({ roles: ['academy_admin'] });
        await (await academy()).startAcademyLiveSessionAction(PAID_COURSE);

        const key = String(docs(COLLECTIONS.ACADEMY_LIVE_SESSIONS)[0].roomKey);
        expect(key).not.toContain(PAID_COURSE);
        expect(key).not.toContain('academy');
        expect(classroomRoomName(key)).not.toContain(PAID_COURSE);
    });

    it('re-starting keeps the key, so the people already in the room stay in it', async () => {
        signedInAs({ roles: ['academy_admin'] });
        await (await academy()).startAcademyLiveSessionAction(FREE_COURSE);
        const first = String(docs(COLLECTIONS.ACADEMY_LIVE_SESSIONS)[0].roomKey);

        await (await academy()).startAcademyLiveSessionAction(FREE_COURSE);
        expect(store.size(COLLECTIONS.ACADEMY_LIVE_SESSIONS)).toBe(1);
        expect(docs(COLLECTIONS.ACADEMY_LIVE_SESSIONS)[0].roomKey).toBe(first);
    });

    it('A ROW WRITTEN BEFORE THIS FINDING GETS A REAL KEY on the next start', async () => {
        // The old rows carry no roomKey at all. They must not go on being
        // opened by a guessable name.
        store.seed(COLLECTIONS.ACADEMY_LIVE_SESSIONS, 'legacy', {
            courseId: FREE_COURSE, status: 'live', title: 'Old class',
        });
        signedInAs({ roles: ['academy_admin'] });

        await (await academy()).startAcademyLiveSessionAction(FREE_COURSE);

        expect(isMintedRoomKey(store.get(COLLECTIONS.ACADEMY_LIVE_SESSIONS, 'legacy')!.roomKey))
            .toBe(true);
    });

    it('THE KEY IS STRIPPED FOR A LEARNER WHOSE PLAN DOES NOT OPEN THE COURSE', async () => {
        // This is the whole point. #267 stripped the meeting link and the
        // classroom went around it, because the browser could compute the room.
        store.seed(COLLECTIONS.ACADEMY_LIVE_SESSIONS, 'live-paid', {
            courseId: PAID_COURSE, status: 'live', title: 'Live: Trade Finance',
            meetingLink: `/academy/live/${PAID_COURSE}`,
            roomKey: mintClassroomRoomKey(),
        });
        signedInAs({ plan: null });

        const res = await (await academy()).getLiveSessionsAction(PAID_COURSE) as any;
        expect(res.success).toBe(true);
        expect(res.data[0].roomKey).toBeUndefined();
        expect(res.data[0].meetingLink).toBeUndefined();
        // The ROW stays — a learner seeing that a class exists is the padlock.
        expect(res.data[0].title).toBe('Live: Trade Finance');
    });

    it('an entitled learner DOES receive the key', async () => {
        const key = mintClassroomRoomKey();
        store.seed(COLLECTIONS.ACADEMY_LIVE_SESSIONS, 'live-paid', {
            courseId: PAID_COURSE, status: 'live', title: 'Live: Trade Finance', roomKey: key,
        });
        signedInAs({ plan: 'elite' });

        const res = await (await academy()).getLiveSessionsAction(PAID_COURSE) as any;
        expect(res.data[0].roomKey).toBe(key);
    });

    it('a free-tier class hands its key to any signed-in learner', async () => {
        const key = mintClassroomRoomKey();
        store.seed(COLLECTIONS.ACADEMY_LIVE_SESSIONS, 'live-free', {
            courseId: FREE_COURSE, status: 'live', title: 'Live: Intro', roomKey: key,
        });
        signedInAs({ plan: null });

        const res = await (await academy()).getLiveSessionsAction(FREE_COURSE) as any;
        expect(res.data[0].roomKey).toBe(key);
    });

    it('an unauthenticated caller receives nothing at all', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'expired' } });
        const res = await (await academy()).getLiveSessionsAction() as any;
        expect(res.success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#188 — the WAVE classroom is minted and gated', () => {
    const wave = async () => await import('@/app/actions/wave/_wv_admin_live');

    it('the room key read is behind wave:manage_training', async () => {
        signedInAs({ roles: ['general_user'] });
        const res = await (await wave()).getWaveLiveRoomKeyAction('evt-1') as any;
        expect(res.success).toBe(false);
        expect(res.error).toBe('Unauthorized');
    });

    it('IT RETURNS NULL RATHER THAN MINTING — only starting a class mints', async () => {
        // A read that minted would hand out a working room for a class that is
        // not running, which is the guessable room by another route.
        signedInAs({ roles: ['wave_admin'] });
        const res = await (await wave()).getWaveLiveRoomKeyAction('evt-none') as any;
        expect(res.success).toBe(true);
        expect(res.data.roomKey).toBeNull();
        expect(store.size(COLLECTIONS.WAVE_TRAINING_SESSIONS)).toBe(0);
    });

    it('it returns the stored key for a running class', async () => {
        const key = mintClassroomRoomKey();
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 's1', {
            roomName: 'wave-training-evt-1', roomKey: key, isActive: true,
        });
        signedInAs({ roles: ['wave_admin'] });

        const res = await (await wave()).getWaveLiveRoomKeyAction('evt-1') as any;
        expect(res.data.roomKey).toBe(key);
    });

    it('a row with no key answers null, not an empty string that would open a room', async () => {
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 's1', {
            roomName: 'wave-training-evt-1', isActive: true,
        });
        signedInAs({ roles: ['wave_admin'] });

        const res = await (await wave()).getWaveLiveRoomKeyAction('evt-1') as any;
        expect(res.data.roomKey).toBeNull();
    });

    it('STARTING A WAVE CLASS MINTS A KEY, not a name derived from the event', async () => {
        store.seed(COLLECTIONS.WAVE_TRAINING_EVENTS, 'evt-1', {
            title: 'Export documentation', duration: '2 hours', status: 'upcoming',
        });
        signedInAs({ roles: ['wave_admin'] });

        const res = await (await wave()).startWaveLiveSessionAction('evt-1') as any;
        expect(res.success).toBe(true);
        expect(isMintedRoomKey(res.data.roomKey)).toBe(true);

        const rows = docs(COLLECTIONS.WAVE_TRAINING_SESSIONS);
        expect(rows).toHaveLength(1);
        expect(isMintedRoomKey(rows[0].roomKey)).toBe(true);
        expect(String(rows[0].roomKey)).not.toContain('evt-1');
        expect(String(rows[0].roomKey)).not.toContain('wave-training');
        // `roomName` survives as the correlation key, and opens nothing.
        expect(rows[0].roomName).toBe('wave-training-evt-1');
    });

    it('re-starting a WAVE class KEEPS the key', async () => {
        const key = mintClassroomRoomKey();
        store.seed(COLLECTIONS.WAVE_TRAINING_EVENTS, 'evt-1', {
            title: 'Export documentation', duration: '2 hours', status: 'upcoming',
        });
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 's1', {
            roomName: 'wave-training-evt-1', roomKey: key, isActive: false,
        });
        signedInAs({ roles: ['wave_admin'] });

        const res = await (await wave()).startWaveLiveSessionAction('evt-1') as any;
        expect(res.data.roomKey).toBe(key);
        expect(store.get(COLLECTIONS.WAVE_TRAINING_SESSIONS, 's1')!.roomKey).toBe(key);
    });

    it('A ROW WRITTEN BEFORE THIS FINDING GETS A REAL KEY on the next start', async () => {
        store.seed(COLLECTIONS.WAVE_TRAINING_EVENTS, 'evt-1', {
            title: 'Export documentation', duration: '2 hours', status: 'upcoming',
        });
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 's1', {
            roomName: 'wave-training-evt-1', isActive: false,
        });
        signedInAs({ roles: ['wave_admin'] });

        await (await wave()).startWaveLiveSessionAction('evt-1');
        expect(isMintedRoomKey(store.get(COLLECTIONS.WAVE_TRAINING_SESSIONS, 's1')!.roomKey))
            .toBe(true);
    });

    it('THE READ IS SCOPED TO THE EVENT — it cannot hand out another class\'s key', async () => {
        const mine = mintClassroomRoomKey();
        const theirs = mintClassroomRoomKey();
        // The other event's row is seeded FIRST and its id sorts FIRST, so an
        // unscoped query would return it at docs[0] however the store orders.
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 'aaa-another-event', {
            roomName: 'wave-training-evt-other', roomKey: theirs, isActive: true,
        });
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 'zzz-this-event', {
            roomName: 'wave-training-evt-1', roomKey: mine, isActive: true,
        });
        signedInAs({ roles: ['wave_admin'] });

        const res = await (await wave()).getWaveLiveRoomKeyAction('evt-1') as any;
        expect(res.data.roomKey).toBe(mine);
        expect(res.data.roomKey).not.toBe(theirs);
    });

    it('A FAILED READ IS REPORTED AS A FAILURE, not as "no classroom"', async () => {
        // #313's lesson. "There is no classroom" and "I could not find out"
        // must not look the same to the page.
        (global as any).mockFirestoreGet.mockRejectedValue(new Error('database unreachable'));
        signedInAs({ roles: ['wave_admin'] });

        const res = await (await wave()).getWaveLiveRoomKeyAction('evt-1') as any;
        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
    });

    it('THE AUDIT LOG DOES NOT RECORD THE KEY', () => {
        // The admin audit log is readable by all ten admin roles, and the key
        // is the credential that opens the room.
        const src = source(WAVE_ACTIONS);
        expect(src).toContain('metadata: { phase: "start", roomName, meetingLink: finalMeetingLink }');
        expect(src).not.toMatch(/metadata:[^}]*roomKey/);
    });

    it('`roomName` survives as the row\'s correlation key, and opens nothing', () => {
        // It is still how the session row for an event is found — a legitimate
        // use for a derived identifier. It is simply not the classroom.
        const src = source(WAVE_ACTIONS);
        expect(src).toContain('.where("roomName", "==", roomName)');
        expect(src).toContain('roomKey');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#188 — the component refuses a guessable room', () => {
    it('THE PROP IS THE KEY, NOT A NAME the caller composed', () => {
        const src = source(COMPONENT);
        expect(src).toContain('roomKey: string;');
        expect(src).not.toMatch(/\broomName: string;/);
    });

    it('THE COMPONENT NO LONGER BUILDS THE NAME ITSELF', () => {
        // `roomName: \`EasySalesExport-${roomName}\`` was the line that turned a
        // course id into a public room.
        const src = source(COMPONENT);
        expect(src).not.toContain('`EasySalesExport-${');
        expect(src).toContain('classroomRoomName(roomKey)');
        expect(src).toContain('from "@/lib/classroom-room"');
    });

    it('A KEY IT CANNOT VALIDATE OPENS NOTHING', () => {
        // Defence in depth: even if a caller regressed to passing a derived
        // name, this component shows the closed-classroom notice rather than
        // opening a public room. The previous version opened whatever it got.
        const src = source(COMPONENT);
        expect(src).toContain('if (!fullRoomName) {');
        expect(src).toContain('This classroom is not open.');
        // And the refusal happens BEFORE the script is loaded — a guard after
        // the load has already fetched from meet.jit.si and, worse, would let
        // initializeJitsi run.
        const guardAt = src.indexOf('if (!fullRoomName) {');
        // indexOf, not lastIndexOf: what matters is that NO call precedes the
        // guard, and a lastIndexOf would be satisfied by a later one.
        const loadAt = src.indexOf('loadJitsiScript();');
        expect(guardAt).toBeGreaterThan(-1);
        expect(loadAt).toBeGreaterThan(-1);
        expect(guardAt).toBeLessThan(loadAt);
    });

    it('THE MODERATOR TURNS THE LOBBY ON — this code turned it OFF', () => {
        const src = source(COMPONENT);
        expect(src).toContain('executeCommand("toggleLobby", true)');
        expect(src).not.toContain('executeCommand("toggleLobby", false)');
        // Only a moderator can, which is why it is on that branch.
        expect(src).toMatch(/if \(isModeratorRef\.current\) \{\s*\n\s*apiRef\.current\.executeCommand\("toggleLobby", true\);/);
    });

    it('nobody is dropped straight into the room', () => {
        const src = source(COMPONENT);
        expect(src).toContain('prejoinPageEnabled: true');
        expect(src).not.toContain('prejoinPageEnabled: false');
    });

    it('THE KEY IS NEVER RENDERED — not in the subject, not in the loading text', () => {
        // The Jitsi subject is shown to everybody in the call. Putting the
        // credential there would hand it to the person it keeps out.
        const src = source(COMPONENT);
        expect(src).not.toMatch(/subject:[^,]*roomKey/);
        expect(src).not.toContain('Setting up room: {');
        expect(src).not.toMatch(/\{roomKey\}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#188 — no screen composes a room name any more', () => {
    it('EVERY CLASSROOM PAGE PASSES A KEY, and none of them derives it', () => {
        expect(CLASSROOM_PAGES).toHaveLength(4);

        for (const page of CLASSROOM_PAGES) {
            const src = source(page);
            expect(src).toContain('roomKey={');
            expect(src).not.toMatch(/roomName=\{/);
        }
    });

    it('NONE OF THE RETIRED EXPRESSIONS NAMES A CLASSROOM', () => {
        expect(RETIRED_ROOM_NAME_EXPRESSIONS.length).toBeGreaterThan(0);

        for (const page of CLASSROOM_PAGES) {
            const src = source(page);
            for (const retired of RETIRED_ROOM_NAME_EXPRESSIONS) {
                expect(src).not.toContain(retired);
            }
        }
    });

    it('the key each page passes comes from the SERVER, not from the URL', () => {
        // The two academy pages read it off the live-session row; the WAVE
        // admin page asks the permission-gated action; the WAVE member page
        // reads the entitlement-gated API's answer.
        expect(source('src/app/academy/live/[courseId]/page.tsx'))
            .toContain('roomKey={liveSession?.roomKey ?? ""}');
        expect(source('src/app/admin/academy/live/[courseId]/page.tsx'))
            .toContain('const roomKey = liveSession?.roomKey ?? "";');
        expect(source('src/app/admin/wave/training/live/[eventId]/page.tsx'))
            .toContain('getWaveLiveRoomKeyAction(eventId)');
        expect(source('src/app/wave/(member)/live-training/page.tsx'))
            .toContain('roomKey={activeSession.roomKey ?? ""}');
    });

    it('the WAVE API serves the key, behind the programme gate it already had', () => {
        const src = source(WAVE_API);
        expect(src).toContain('roomKey: data.roomKey ?? null');
        expect(src).toContain('canReadWaveProgramme');
        // And a session scheduled through this route gets a key of its own.
        expect(src).toContain('roomKey: mintClassroomRoomKey()');
    });

    it('the academy strip removes the key alongside the meeting link', () => {
        const src = source(ACADEMY_ACTIONS);
        expect(src).toContain('delete row.meetingLink;');
        expect(src).toContain('delete row.roomKey;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#188 — what is NOT closed is stated, not implied', () => {
    it('the limit is written down where the next reader will find it', () => {
        // meet.jit.si does not authenticate participants. Somebody GIVEN the
        // key can still reach the lobby. Claiming otherwise would be worse than
        // the defect.
        const raw = readFileSync(join(ROOT, RULE), 'utf-8');
        expect(raw).toContain('CLASSROOM_JWT_IS_NOT_CONFIGURED');
        expect(raw).toContain('does not authenticate participants');
        expect(raw).toContain('hosting and cost decision');
    });

    it('the component carries the same marker, so the work is a grep', () => {
        // TWICE, and both are load-bearing: once in the header, which is where
        // somebody reading the component starts, and once beside the lobby
        // command, which is the compensating control the marker qualifies. One
        // without the other leaves the reader thinking the lobby IS the answer.
        const raw = readFileSync(join(ROOT, COMPONENT), 'utf-8');
        const hits = raw.split('CLASSROOM_JWT_IS_NOT_CONFIGURED').length - 1;
        expect(hits).toBeGreaterThanOrEqual(2);
    });
});
