/**
 * @jest-environment node
 */

/**
 *   #787 THE LIVE SESSION WAS RUNNING. THE MEMBERS' SCREEN COULD NOT SEE IT.
 *
 *   The owner, on their formal list: "The Live Training feature is not
 *   connecting or functioning as expected and does not allow end users to join
 *   the training."
 *
 *   #778 fixed WHO HOSTS — the room opens when an administrator presses Start,
 *   not when the clock reaches the scheduled minute. This is a different defect
 *   and it is upstream of that one: the session the host started never reached
 *   the member's browser at all.
 *
 * ── THE QUERY ───────────────────────────────────────────────────────────────
 *
 *       .where("isActive", "==", true)
 *       .orderBy("scheduledAt", "asc")      ← OLDEST FIRST
 *       .limit(limit + 1)                   ← twenty
 *
 *   and LiveTrainingClient asks for exactly one page and never follows the
 *   cursor. So a member receives the twenty OLDEST sessions that have not been
 *   ended — and the only thing that ends one is an administrator remembering to
 *   press End. Closing the browser tab does not. `endWaveLiveSessionAction` is
 *   the sole writer of `isActive: false`.
 *
 *   MEASURED, not reasoned about: twenty stale rows plus one session started a
 *   minute ago, and the reader returns the twenty stale ones. findOpenSession
 *   over that list returns null, so the screen renders "No live session is
 *   running right now" while the host sits alone in the classroom.
 *
 *   It gets worse every week the platform runs, which is the shape of the
 *   owner's standing complaint that this application "has always broken in one
 *   way or the other". Nothing changed on the day it broke. The twenty-first
 *   session was scheduled.
 *
 * ── AND A SENTENCE THAT STOPPED BEING TRUE ──────────────────────────────────
 *
 *   The empty-state banner read "The room opens automatically when a scheduled
 *   session begins." That is the rule #778 REPLACED. A member sitting on the
 *   screen at the scheduled minute was waiting for something that no longer
 *   happens and had no way to know it.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the findRunningSession call removed                          KILLED
 *     the page's own ids no longer excluded (duplicate row)        KILLED
 *     the running scan ordered "asc" instead of "desc"             KILLED
 *     projectSession dropping roomKey for the running row          KILLED
 *     the grace window reduced to the exact instant                SURVIVED
 *                                             → then, rewritten:   KILLED
 *     the corrected banner sentence reverted                       KILLED
 *     the running scan no longer filtering ended sessions          KILLED
 *     reword this header                                SURVIVED, intended
 *
 *   THE SURVIVOR IS RECORDED BECAUSE IT MATTERS. The grace-window test read the
 *   source for `GRACE_MS`, and setting GRACE_MS to zero leaves every one of
 *   those strings in the file. Rewritten to seed a session sixty-five minutes
 *   into a sixty-minute slot and assert it is delivered although this clock
 *   calls it closed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { findOpenSession } from '@/lib/live-session-window';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

let store: FakeDbHandle;
beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const MEMBER = { user: { id: 'member-1', roles: ['wave_participant'] } } as any;

/** A past session nobody pressed End on. */
function seedStale(i: number): void {
    const when = new Date(Date.UTC(2025, 0, i + 1)).toISOString();
    store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, `stale-${i}`, {
        title: `Week ${i}`,
        description: '',
        scheduledAt: when,
        durationMinutes: 60,
        roomName: `wave-training-old-${i}`,
        roomKey: `key-old-${i}`,
        isActive: true,
        startedAt: when,
    });
}

/** The session an administrator pressed Start on a minute ago. */
function seedRunning(id = 'live-now'): void {
    const now = new Date(Date.now() - 60_000).toISOString();
    store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, id, {
        title: 'Today, live',
        description: '',
        scheduledAt: now,
        durationMinutes: 60,
        roomName: 'wave-training-today',
        roomKey: 'key-today-secret',
        isActive: true,
        startedAt: now,
    });
}

const reader = () => import('@/lib/wave-training-reader');

// ─────────────────────────────────────────────────────────────────────────────
describe('#787 — the running session reaches the member', () => {
    it('THE FIXTURE REALLY DOES OVERFLOW THE PAGE', async () => {
        /*
         *   Vacuity guard, and the measurement the finding rests on. Every
         *   assertion below is trivially true of a fixture small enough to fit
         *   in one page — which is exactly the fixture under which this defect
         *   was invisible for as long as it existed.
         */
        for (let i = 0; i < 20; i++) seedStale(i);
        seedRunning();

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        //   The page is full of stale rows: the running one is not there on
        //   the strength of the ordinary query.
        const staleOnPage = result.sessions.filter(s => s.id.startsWith('stale-'));
        expect(staleOnPage.length).toBe(20);
        expect(result.hasMore).toBe(true);
    });

    it('AND THE SESSION THAT IS RUNNING IS ON IT ANYWAY', async () => {
        for (let i = 0; i < 20; i++) seedStale(i);
        seedRunning();

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        expect(result.sessions.map(s => s.id)).toContain('live-now');
    });

    it('AND THE MEMBER SCREEN\'S OWN RULE FINDS IT — which is the actual defect', async () => {
        /*
         *   THE test. LiveTrainingClient does exactly this with what the reader
         *   hands it, and before the fix it returned null while an administrator
         *   sat in the room: "No live session is running right now."
         */
        for (let i = 0; i < 20; i++) seedStale(i);
        seedRunning();

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        const open = findOpenSession(result.sessions as any) as any;
        expect(open).not.toBeNull();
        expect(open.id).toBe('live-now');
    });

    it('AND IT CARRIES THE KEY THAT OPENS THE ROOM', () => {
        /*
         *   A row delivered without `roomKey` is a row VideoClassroom refuses —
         *   "This classroom is not open" — so a second projection that dropped
         *   it would move the defect rather than fix it. That is the #349/#773
         *   shape, and it is why there is one projectSession and not two.
         */
        const src = stripComments(read('src/lib/wave-training-reader.ts'));
        expect((src.match(/function projectSession/g) ?? []).length).toBe(1);
        expect((src.match(/\.map\(projectSession\)/g) ?? []).length).toBe(2);
    });

    it('and the key really is on the row the member receives', async () => {
        for (let i = 0; i < 20; i++) seedStale(i);
        seedRunning();

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        const open = findOpenSession(result.sessions as any)!;
        expect((open as any).roomKey).toBe('key-today-secret');
    });

    it('DOES NOT PUT THE SAME SESSION ON THE PAGE TWICE', async () => {
        //   With few sessions the running one is already on the page, and a
        //   blind unshift would render it as two live sessions.
        seedRunning();

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        expect(result.sessions.filter(s => s.id === 'live-now').length).toBe(1);
    });

    it('CONTROL: nothing running means nothing is added', async () => {
        /*
         *   Otherwise this finding would have replaced "cannot join a live
         *   session" with "is shown a live session that ended in January",
         *   which is the worse of the two.
         */
        for (let i = 0; i < 20; i++) seedStale(i);

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        expect(findOpenSession(result.sessions as any)).toBeNull();
        expect(result.sessions.length).toBe(20);
    });

    it('CONTROL: an ENDED session is not resurrected by this path', async () => {
        //   isActive false is the one thing that removes a session from a
        //   member's view, and the new lookup queries on it too.
        const now = new Date(Date.now() - 60_000).toISOString();
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 'ended', {
            title: 'Ended', description: '', scheduledAt: now, durationMinutes: 60,
            roomName: 'wave-training-ended', roomKey: 'k', isActive: false, startedAt: now,
        });

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        expect(result.sessions.map(s => s.id)).not.toContain('ended');
    });

    it('CONTROL: the gate still refuses somebody outside the programme', async () => {
        //   This listing carries roomKey. The lookup added here runs AFTER the
        //   gate and must not have become a second way in.
        seedRunning();
        const { readWaveTrainingSessions } = await reader();
        const outsider = await readWaveTrainingSessions(
            { user: { id: 'nobody', roles: ['user'] } } as any, { limit: 20 });

        expect(outsider.allowed).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#787 — the lookup is bounded, and looks the right way', () => {
    it('newest-first, because that is where a running session is', () => {
        /*
         *   startWaveLiveSessionAction stamps `scheduledAt: new Date()` at the
         *   moment of starting — both branches of it — so the running session is
         *   the most recently scheduled row by construction. Ordered the other
         *   way, this lookup would read the same twenty stale rows the page
         *   already had and change nothing.
         */
        const src = stripComments(read('src/lib/wave-training-reader.ts'));
        const fn = src.split('async function findRunningSession')[1].split('\nfunction ')[0];

        expect(fn).toMatch(/orderBy\("scheduledAt", "desc"\)/);
        expect(fn).toMatch(/where\("isActive", "==", true\)/);
        expect(fn).toMatch(/limit\(RUNNING_SESSION_SCAN\)/);
    });

    it('and the scan is capped rather than open-ended', () => {
        //   An unbounded read of this collection is the defect on the other
        //   side of the one being fixed.
        const src = stripComments(read('src/lib/wave-training-reader.ts'));
        expect(src).toMatch(/const RUNNING_SESSION_SCAN = \d+;/);
    });

    it('AND THE VIEWER\'S CLOCK, NOT THE SERVER\'S, DECIDES WHAT IS SHOWN', () => {
        /*
         *   LiveTrainingClient runs findOpenSession itself, deliberately, so
         *   the arithmetic happens on the side that has the viewer's clock. The
         *   server only decides what to SEND.
         */
        const client = stripComments(read('src/app/wave/(member)/live-training/LiveTrainingClient.tsx'));
        expect(client).toMatch(/setActiveSession\(findOpenSession\(all\)\)/);
    });

    it('SO A ROW THE VIEWER WOULD CALL OPEN IS SENT EVEN IF THE SERVER WOULD NOT', async () => {
        /*
         *   The consequence of the line above, and the reason for the grace
         *   window. Because the two clocks are not the same clock, they
         *   disagree at the edges of the window — and the disagreement is not
         *   symmetric in cost. An extra row the viewer discards costs nothing;
         *   a row withheld cannot be recovered, and reads to the member as
         *   exactly the defect this finding is about.
         *
         *   Sixty-five minutes into a sixty-minute session: CLOSED by this
         *   server's clock, and still open to a viewer five minutes behind it.
         *
         *   EXECUTED, because the first draft of this test read the source for
         *   `GRACE_MS` and the mutation sweep walked through it — GRACE_MS set
         *   to zero leaves every one of those strings in the file. That is the
         *   #741 shape for the seventh time in this audit.
         */
        const started = new Date(Date.now() - 65 * 60_000).toISOString();
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 'edge', {
            title: 'Overrunning', description: '', scheduledAt: started,
            durationMinutes: 60, roomName: 'wave-training-edge',
            roomKey: 'k-edge', isActive: true, startedAt: started,
        });
        for (let i = 0; i < 20; i++) seedStale(i);

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        //   Not open by THIS clock — which is exactly the point.
        expect(findOpenSession(result.sessions as any)).toBeNull();
        //   And delivered anyway, so a viewer whose clock says otherwise can act.
        expect(result.sessions.map(s => s.id)).toContain('edge');
    });

    it('CONTROL: the grace is a few minutes, not "always send the newest"', async () => {
        /*
         *   Without this, the assertion above is satisfied by a lookup that
         *   unconditionally prepends the most recent session — which would put
         *   a class that ended in January at the top of every member's screen.
         */
        const started = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
        store.seed(COLLECTIONS.WAVE_TRAINING_SESSIONS, 'long-over', {
            title: 'This morning', description: '', scheduledAt: started,
            durationMinutes: 60, roomName: 'wave-training-over',
            roomKey: 'k-over', isActive: true, startedAt: started,
        });
        for (let i = 0; i < 20; i++) seedStale(i);

        const { readWaveTrainingSessions } = await reader();
        const result = await readWaveTrainingSessions(MEMBER, { limit: 20 });
        if (!result.allowed) throw new Error('the gate refused the fixture');

        expect(result.sessions.map(s => s.id)).not.toContain('long-over');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#787 — and the screen no longer states the old rule', () => {
    const CLIENT = 'src/app/wave/(member)/live-training/LiveTrainingClient.tsx';

    it('THE BANNER SAYS WHAT ACTUALLY OPENS THE ROOM', () => {
        //   COMMENTS STRIPPED: the comment that documents this change quotes
        //   the old sentence in order to explain it, and an assertion that
        //   reads the comment rather than the screen is the trap this audit has
        //   now met six times.
        const src = stripComments(read(CLIENT));

        expect(src).not.toMatch(/opens automatically when a scheduled session begins/);
        expect(src).toMatch(/as soon as your trainer starts the session/);
    });

    it('and it still tells the member the page refreshes itself', () => {
        //   Without that, the honest version of the sentence — "wait for your
        //   trainer" — reads as "come back and reload", which the poll makes
        //   unnecessary.
        const src = stripComments(read(CLIENT));
        expect(src).toMatch(/checks every minute/);
        expect(src).toMatch(/startVisibilityAwareInterval\(fetchSessions, 60_000\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#787 — the other module, checked rather than assumed', () => {
    it('THE ACADEMY LIVE LISTING DOES NOT HAVE THIS DEFECT', () => {
        /*
         *   The owner's standing instruction is that a fix here is applied to
         *   the other modules if they behave the same way. This one does not:
         *   _getLiveSessionsAction filters by courseId and takes no `.limit()`
         *   and no ascending `orderBy`, so there is no page for a running
         *   session to fall off the end of. Its own bound is the adapter's
         *   default cap.
         *
         *   Recorded as a CHECK, not a fix. Writing the same change into a
         *   reader that does not need it is churn with a regression attached,
         *   and "swept and found clean" is half of what a sweep is for. If that
         *   listing ever grows a page, this fails and the sweep is re-run.
         */
        const src = stripComments(read('src/app/actions/academy/_ac_live.ts'));
        const body = src
            .split('async function _getLiveSessionsAction')[1]
            .split('\nexport ')[0];

        expect(body).toMatch(/where\("courseId", "==", courseId\)/);
        expect(body).not.toMatch(/orderBy\("scheduledAt", "asc"\)/);
        expect(body).not.toMatch(/\.limit\(/);
    });
});
