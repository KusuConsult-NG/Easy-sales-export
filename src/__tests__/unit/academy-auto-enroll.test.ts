/**
 * @jest-environment node
 */

/**
 * autoEnrollPaidUser was a paid-content bypass.
 *
 * WHAT WAS WRONG
 * --------------
 *     export async function autoEnrollPaidUser(userId: string, userPlan: string) {
 *         if (!userId || !userPlan) return;
 *         const plan = userPlan.toLowerCase();
 *         const isPaid = ["elite", "standard", ...].includes(plan);
 *         if (!isPaid) return;
 *         // ... enrols `userId` in every course their `plan` unlocks
 *
 * `src/app/actions/academy/_actions.ts` is `"use server"`, so every export is a
 * reachable server action, and this one is re-exported through
 * `academy/index.ts` as well. Both the user and the plan came from the caller,
 * with no session guard.
 *
 * **`autoEnrollPaidUser(myOwnId, "elite")` enrolled the caller in every elite
 * course.** Academy courses are paid.
 *
 * WHY THE EXISTING CHECKS DID NOT HELP
 * ------------------------------------
 * Its two callers — `/api/academy/dashboard` and `getAcademyDashboardAction` —
 * both derive the id and plan from the session and check `isPaid` first. That
 * protected the CALL SITES. The function is independently addressable, so it was
 * never protected at all.
 *
 * The same shape as `setupTestCooperativeAction`, found earlier: a helper that
 * was safe in the flow that used it and reachable outside that flow.
 *
 * HOW IT WAS FOUND
 * ----------------
 * By re-running the scanners scoped PER BUSINESS MODULE rather than per
 * directory. It had appeared in the unguarded baseline all along, in a list of
 * 54 entries that were mostly public catalogue reads, and had never been read.
 * Grouping by module put it beside `getCoursesAction` and `getLiveSessionsAction`,
 * where "auto-enrol" stopped looking like a catalogue read.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const CALLER = 'caller-1';
const VICTIM = 'victim-1';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({ createNotificationAction: jest.fn(async () => ({})) }));

function setSession(id: string | null, plan?: string) {
    (global as any).mockRequireSession.mockImplementation(() =>
        id === null
            ? Promise.resolve({ session: null, error: { error: 'Authentication required' } })
            : Promise.resolve({
                session: {
                    user: {
                        id,
                        email: `${id}@e.com`,
                        roles: [],
                        serviceRegistrations: plan ? { academy: { plan } } : {},
                    },
                },
                error: null,
            })
    );
}

/**
 * One elite course exists, and the caller's STORED academy registration.
 *
 *   #460 THE STORED PLAN IS NOW THE AUTHORITY, so the fixture has to say what
 *        the user document holds — not only what the token claims. The mock is
 *        called as mockFirestoreGet(id, collection) for a document read and
 *        mockFirestoreGet(name) for a collection read, so the two are told
 *        apart rather than answered with one object that happens to satisfy
 *        both.
 */
function setCourses(stored?: { plan?: string; status?: string }) {
    (global as any).mockFirestoreGet.mockImplementation((...args: any[]) => {
        const [first, collection] = args;

        if (collection === 'users' || String(first).startsWith('caller') || String(first).startsWith('victim')) {
            return Promise.resolve({
                exists: true,
                data: () => (stored
                    ? { serviceRegistrations: { academy: { ...stored } } }
                    : {}),
            });
        }

        return Promise.resolve({
            exists: true,
            empty: false,
            docs: [{ id: 'course-1', data: () => ({ title: 'Elite Course', tier: 'elite' }) }],
            data: () => ({ title: 'Elite Course', tier: 'elite' }),
        });
    });
}

/**
 * Enrolment writes, however they are made.
 *
 * The function writes with `progressSubRef.set(...)`. The harness stubbed
 * docRef.set() as a silent no-op that recorded nothing, so this counted zero
 * however the function behaved — the vacuity guard below caught it, and
 * jest.setup.js now records the call.
 */
function enrolmentWrites(): number {
    return (global as any).mockFirestoreSet.mock.calls.length
        + (global as any).mockFirestoreAdd.mock.calls.length
        + (global as any).mockFirestoreBatchUpdate.mock.calls.length;
}

async function autoEnrol(userId: string, plan: string) {
    const { autoEnrollPaidUser } = await import('@/app/actions/academy/_ac_enrollment');
    return autoEnrollPaidUser(userId, plan);
}

describe('autoEnrollPaidUser', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCourses();
    });

    it('enrols nobody when the caller has no paid plan, whatever they claim', async () => {
        // THE test. The caller is on "free" and asks for "elite".
        setCourses({ plan: 'free' });
        setSession(CALLER, 'free');

        await autoEnrol(CALLER, 'elite');

        expect(enrolmentWrites()).toBe(0);
    });

    it('ignores the userId argument entirely', async () => {
        // Passing someone else's id must not enrol them — and must not enrol
        // the caller into anything they have not paid for either.
        setCourses({ plan: 'free' });
        setSession(CALLER, 'free');

        await autoEnrol(VICTIM, 'elite');

        expect(enrolmentWrites()).toBe(0);
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        await autoEnrol(CALLER, 'elite');

        expect(enrolmentWrites()).toBe(0);
    });

    it('still enrols a genuinely paid user', async () => {
        // Vacuity guard. Every assertion above is satisfied by a function that
        // enrols nobody, which would silently break paid access for real
        // students — a worse outcome than the bug.
        setCourses({ plan: 'elite' });
        setSession(CALLER, 'elite');

        await autoEnrol(CALLER, 'elite');

        expect(enrolmentWrites()).toBeGreaterThan(0);
    });

    it('uses the STORED plan, not the argument', async () => {
        // A paid user asking for a tier above their own gets their own.
        setCourses({ plan: 'foundation' });
        setSession(CALLER, 'foundation');

        await autoEnrol(CALLER, 'elite');

        // Foundation does not unlock an elite course, so nothing is written.
        expect(enrolmentWrites()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#460 — the entitlement comes from the row, not from an 8-hour-old token', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('A FRESH PAYMENT ENROLS, even though the token still says "free"', () => {
        //   THE USER-VISIBLE BUG. auth.config issues stateless JWTs with an
        //   8-hour maxAge, so somebody who pays mid-session carries a claim that
        //   predates the payment. The plan was read from that claim, and both
        //   call sites additionally computed `isPaid` from it and SKIPPED THE
        //   CALL — so the person was charged and the academy stayed empty until
        //   their token happened to refresh.
        setCourses({ plan: 'elite' });      // what they actually bought
        setSession(CALLER, 'free');         // what the token still says

        return autoEnrol(CALLER, '').then(() => {
            expect(enrolmentWrites()).toBeGreaterThan(0);
        });
    });

    it('AND A REJECTED APPLICANT ENROLS IN NOTHING, even though the token says paid', async () => {
        // The other direction. An admin's decision took up to eight hours to
        // take effect, while enrolment and progress rows kept accruing for
        // courses the module gate will not open.
        setCourses({ plan: 'elite', status: 'rejected' });
        setSession(CALLER, 'elite');

        await autoEnrol(CALLER, 'elite');

        expect(enrolmentWrites()).toBe(0);
    });

    it('AND A DOWNGRADE TAKES EFFECT AT ONCE', async () => {
        setCourses({ plan: 'free' });       // downgraded in the database
        setSession(CALLER, 'elite');        // token still carries the old tier

        await autoEnrol(CALLER, 'elite');

        expect(enrolmentWrites()).toBe(0);
    });

    it('AND AN UNREADABLE USER DOCUMENT ENROLS NOBODY', async () => {
        // This function writes rows and runs on every dashboard load, so a
        // retry costs nothing and a wrong grant persists. Denying is the safe
        // direction for an unreadable document — and it must not throw, or the
        // whole dashboard fails with it.
        setCourses({ plan: 'elite' });
        setSession(CALLER, 'elite');

        //   ONLY THE USER READ FAILS. My first version of this rejected EVERY
        //   read, which made the course fetch fail too — so a mutant that fell
        //   back to the session claim still wrote nothing, and survived. A test
        //   that cannot tell the two apart is not testing the one it names.
        const courses = (global as any).mockFirestoreGet.getMockImplementation();
        (global as any).mockFirestoreGet.mockImplementation((...args: any[]) =>
            args[1] === 'users'
                ? Promise.reject(new Error('database unavailable'))
                : courses(...args));

        await expect(autoEnrol(CALLER, 'elite')).resolves.toBeUndefined();
        expect(enrolmentWrites()).toBe(0);
    });

    it('and a user document that does not exist enrols nobody', async () => {
        setCourses({ plan: 'elite' });
        setSession(CALLER, 'elite');

        // Again, only the USER document is missing — the courses are there, so
        // dropping the `exists` check would enrol rather than quietly find
        // nothing to enrol into.
        const courses = (global as any).mockFirestoreGet.getMockImplementation();
        (global as any).mockFirestoreGet.mockImplementation((...args: any[]) =>
            args[1] === 'users'
                ? Promise.resolve({ exists: false, data: () => undefined })
                : courses(...args));

        await autoEnrol(CALLER, 'elite');

        expect(enrolmentWrites()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#460 — neither caller gates on the stale claim any more', () => {
    const source = (rel: string) => {
        const { readFileSync } = require('fs');
        const { stripComments } = require('@/lib/testing/strip-comments');
        return stripComments(readFileSync(rel, 'utf-8'));
    };

    const CALLERS = [
        'src/app/api/academy/dashboard/route.ts',
        'src/app/actions/academy/_ac_enrollment.ts',
    ];

    it('NEITHER COMPUTES isPaid FROM session.user — that gate skipped the call', () => {
        const offenders = CALLERS.filter((rel) =>
            /serviceRegistrations\??\.academy\??\.plan/.test(source(rel))
            && /session/.test(source(rel).split('autoEnrollPaidUser')[0].slice(-400)));

        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('AND BOTH CALL IT UNCONDITIONALLY', () => {
        for (const rel of CALLERS) {
            const code = source(rel);
            expect({ rel, guarded: /if \(isPaid\)/.test(code) }).toEqual({ rel, guarded: false });
            expect({ rel, calls: /await autoEnrollPaidUser\(/.test(code) }).toEqual({ rel, calls: true });
        }
    });

    it('POSITIVE CONTROL: the scan really would catch the gate it removes', () => {
        expect(/if \(isPaid\)/.test('        if (isPaid) {')).toBe(true);
        expect(/if \(isPaid\)/.test('        await autoEnrollPaidUser(userId, "");')).toBe(false);
    });
});
