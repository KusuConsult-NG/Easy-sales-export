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

/** One elite course exists. */
function setCourses() {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true,
        empty: false,
        docs: [{ id: 'course-1', data: () => ({ title: 'Elite Course', tier: 'elite' }) }],
        data: () => ({ title: 'Elite Course', tier: 'elite' }),
    }));
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
        setSession(CALLER, 'free');

        await autoEnrol(CALLER, 'elite');

        expect(enrolmentWrites()).toBe(0);
    });

    it('ignores the userId argument entirely', async () => {
        // Passing someone else's id must not enrol them — and must not enrol
        // the caller into anything they have not paid for either.
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
        setSession(CALLER, 'elite');

        await autoEnrol(CALLER, 'elite');

        expect(enrolmentWrites()).toBeGreaterThan(0);
    });

    it('uses the plan from the session, not the argument', async () => {
        // A paid user asking for a tier above their own gets their own.
        setSession(CALLER, 'foundation');

        await autoEnrol(CALLER, 'elite');

        // Foundation does not unlock an elite course, so nothing is written.
        expect(enrolmentWrites()).toBe(0);
    });
});
