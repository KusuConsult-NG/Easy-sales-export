/**
 * @jest-environment node
 */

/**
 * Four academy reads: three named the user, one handed out the answers.
 *
 * Every export of a "use server" module is a reachable HTTP endpoint whatever
 * the UI does. Three of these took the user id as an argument with no session
 * check of any kind, and a fourth returned what its own sibling had been fixed
 * to withhold.
 *
 * 1. getUserProgressAction(userId, courseId)   _ac_progress.ts
 *
 *    No session check. Returned that learner's completed lessons, their quiz
 *    SCORES and their completion date. Its five siblings in the same file all
 *    compare `session.user.id !== userId`.
 *
 * 2. calculateStreakAction(userId)             _ac_progress.ts
 *
 *    No session check. Returned that learner's day-by-day activity record. Its
 *    writing counterpart, logLessonActivityAction, takes no id at all precisely
 *    because it derives one from the session.
 *
 * 3. getLiveSessionsAction(courseId?)          _ac_live.ts
 *
 *    No session check, and courseId is OPTIONAL. Called with no arguments it
 *    returned every live session in the collection together with `meetingLink`
 *    and `customMeetingLink` — the Zoom/Meet URL an admin sets when starting a
 *    class. That URL is a bearer credential: holding it is joining.
 *
 * 4. getCoursesAction(limit, lastDocId)        _ac_catalog.ts
 *
 *    getCourseByIdAction strips modules[].quiz.questions[].correctAnswer for
 *    non-admins. This function returns whole course documents and did not, so
 *    the answer-key fix was enforced on one of the two ways to obtain exactly
 *    the same document. The list endpoint handed out the answers.
 *
 * The first three were parked in action-auth-baseline.json, whose own header
 * says the list is a ratchet that "must never become a place to park things
 * quietly". All four are out of it now.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import baseline from './action-auth-baseline.json';

const PROGRESS = 'src/app/actions/academy/_ac_progress.ts';
const LIVE = 'src/app/actions/academy/_ac_live.ts';
const CATALOG = 'src/app/actions/academy/_ac_catalog.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** One function's body, from its declaration to the export that wraps it. */
function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.indexOf(`async function _${name}(`);
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start);
    const end = after.indexOf('\nexport ');
    return end > 0 ? after.slice(0, end) : after;
}

describe('the reads that named the user', () => {
    it.each([
        ['getUserProgressAction', PROGRESS],
        ['calculateStreakAction', PROGRESS],
    ])('%s refuses a caller who is not that user', (name: string, rel: string) => {
        const body = fn(rel, name);

        expect(body).toContain('await requireSession()');
        expect(body).toContain('session.user.id !== userId');
    });

    it('and refuses BEFORE it reads anything', () => {
        // A check after the read has already loaded the record is not a check.
        for (const [name, needle] of [
            ['getUserProgressAction', 'db.doc(`user_progress/'],
            ['calculateStreakAction', 'USER_ACTIVITY_LOGS'],
        ] as const) {
            const body = fn(PROGRESS, name);
            const guard = body.indexOf('session.user.id !== userId');
            const read = body.indexOf(needle);

            expect(guard).toBeGreaterThan(-1);
            expect(read).toBeGreaterThan(guard);
        }
    });

    it('which is what their five siblings in the same file already did', () => {
        // Vacuity guard: the rule being applied is the file's own, not one
        // invented here.
        const src = code(PROGRESS);
        const checks = src.match(/session\.user\.id !== userId/g) || [];

        expect(checks.length).toBeGreaterThanOrEqual(5);
    });
});

describe('the live sessions list', () => {
    it('requires a session', () => {
        const body = fn(LIVE, 'getLiveSessionsAction');

        expect(body).toContain('await requireSession()');
        expect(body).toContain("error: 'Unauthorized'");
    });

    it('before it touches the collection', () => {
        const body = fn(LIVE, 'getLiveSessionsAction');
        const guard = body.indexOf('requireSession()');
        const read = body.indexOf('ACADEMY_LIVE_SESSIONS');

        expect(guard).toBeGreaterThan(-1);
        expect(read).toBeGreaterThan(guard);
    });

    it('and the rows it returns really do carry a join link', () => {
        // Without this the refusal above is protecting nothing in particular.
        const src = code(LIVE);

        expect(src).toContain('meetingLink');
        expect(src).toContain('customMeetingLink');
    });

    it('courseId being optional is what made the unguarded version total', () => {
        const src = code(LIVE);

        expect(src).toContain('_getLiveSessionsAction(courseId?: string)');
    });
});

describe('the course list and the answer key', () => {
    it('strips it for a non-admin, exactly as the single-course read does', () => {
        const body = fn(CATALOG, 'getCoursesAction');

        expect(body).toContain('stripAnswerKey');
        expect(body).toContain('isAdmin(sessionResult.session?.user?.roles)');
    });

    it('and keeps it for an admin, because the editor needs it', () => {
        const body = fn(CATALOG, 'getCoursesAction');

        // The admin branch returns the rows untouched; everyone else goes
        // through the strip. (The expression gained a second step when paid
        // lesson material was gated too — see academy-content-gating.test.ts —
        // so this asserts the branch rather than one exact line of it.)
        expect(body).toContain('viewerIsAdmin');
        expect(body).toContain('? raw');
        expect(body).toContain('stripAnswerKey(');
    });

    it('the same rule as its sibling — not a second, different one', () => {
        const list = fn(CATALOG, 'getCoursesAction');
        const single = fn(CATALOG, 'getCourseByIdAction');

        for (const body of [list, single]) {
            expect(body).toContain('stripAnswerKey');
            expect(body).toContain('viewerIsAdmin');
        }
    });

    it('and the list stays readable without a session — it is a catalogue', () => {
        // The session decides what is INCLUDED, not whether the call is allowed.
        // Refusing here would break the public /academy course listing.
        const body = fn(CATALOG, 'getCoursesAction');

        expect(body).not.toContain("error: 'Unauthorized'");
    });
});

describe('the baseline ratchet', () => {
    it.each([
        'app/actions/academy/_ac_progress.ts::getUserProgressAction',
        'app/actions/academy/_ac_progress.ts::calculateStreakAction',
        'app/actions/academy/_ac_live.ts::getLiveSessionsAction',
        'app/actions/academy/_ac_catalog.ts::getCoursesAction',
    ])('no longer parks %s', (entry: string) => {
        expect((baseline as any).unguarded).not.toContain(entry);
    });

    it('and still lists the ones nobody has fixed yet', () => {
        // Vacuity guard: an empty baseline would pass every assertion above
        // while proving nothing was done.
        expect((baseline as any).unguarded.length).toBeGreaterThan(0);
    });
});
