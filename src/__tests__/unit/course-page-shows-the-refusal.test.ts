/**
 * @jest-environment node
 */

/**
 *   #315 THE COURSE PAGE THREW AWAY THE REFUSAL AN EARLIER FIX WAS WRITTEN TO
 *        PRODUCE.
 *
 *        enrollInCourseAction does not refuse vaguely. #278's write-up records
 *        why it says two different things:
 *
 *            "This read `Your current package (free) does not grant access`
 *             for a learner who had never chosen a package at all — an admin
 *             can approve an application without one, and registration itself
 *             is free — so the message named a package they had not bought and
 *             told them to upgrade from it. Neither they nor support could tell
 *             which of the two situations they were in."
 *
 *        So the action now returns either "Your <plan> package does not grant
 *        access to this course…" or "Your Academy registration does not include
 *        a course package yet…". Two messages, deliberately distinguished.
 *
 *        /academy/[courseId] auto-enrols on load and did this with them:
 *
 *            if (enrollResult.success) { ... } else {
 *                setProgress(null);
 *            }
 *
 *        Both messages, discarded. And the proof it was an oversight rather
 *        than a choice is IN THE SAME FILE: handleEnroll — the manual button —
 *        reads `result.error` and toasts it. One author fixed one call site.
 *        The other one is the one that runs on page load.
 *
 *   WHY IT IS REACHABLE AT ALL
 *
 *        The page checks access before enrolling, so at first glance the server
 *        can never refuse. But that check reads the plan cached on the SESSION
 *        (`session.user.serviceRegistrations.academy.plan`) and the action
 *        reads the live user row. This codebase has been bitten by exactly that
 *        gap before — #115 and #265 are both stale-JWT findings. A learner
 *        whose package changed sees the course, is refused server-side with a
 *        precise reason, and was told nothing.
 *
 *        Stated fairly: they could still press Enroll and see the reason, since
 *        that path was correct. They were never told they needed to.
 *
 *   AND A FAILED READ SAID THE COURSE DID NOT EXIST
 *
 *        The `else` branch was literally `// Handle not found` with no body, so
 *        an unreadable course left `course` null and the render said "Course
 *        Not Found" — #307's shape, on the difference between "this does not
 *        exist" and "we could not fetch it". The two are now distinguished.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const PAGE = 'src/app/academy/[courseId]/page.tsx';
const ACTION = 'src/app/actions/academy/_ac_enrollment.ts';

const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const code = (rel: string) => stripComments(raw(rel), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#315 — the auto-enrolment reports why it was refused', () => {
    it('SHOWS enrollResult.error INSTEAD OF ONLY CLEARING PROGRESS', () => {
        // THE test, on stripped source: the explanation beside the fix quotes
        // the old shape, and must not be what satisfies this.
        const src = code(PAGE);

        expect(src).toMatch(/showToast\(enrollResult\.error \|\|/);
    });

    it('and the empty "Handle not found" branch is gone', () => {
        const src = code(PAGE);

        expect(src).not.toMatch(/\}\s*else\s*\{\s*\}/);
        // BOTH setters, named. `toMatch(/setLoadFailed\(/)` passed while the
        // not-found branch had been gutted, because the one in the catch still
        // matched — the same membership-vs-count trap as #312's manifest and
        // notification assertions. There are exactly two failure routes into
        // this state and both are pinned.
        expect(src).toMatch(/setLoadFailed\(!!courseReq\.error\)/);
        expect(src).toMatch(/if \(mounted\) setLoadFailed\(true\)/);
    });

    it('a failed read is no longer rendered as "Course Not Found"', () => {
        const src = code(PAGE);

        expect(src).toMatch(/loadFailed \? "We could not load this course" : "Course Not Found"/);
    });

    it('the reload after a successful enrolment reports its own failure too', () => {
        // loadCourse ran `if (courseReq.data) {...}` with no else, so a failed
        // refresh left stale state under a success toast.
        const src = code(PAGE);

        expect(src).toMatch(/Could not reload this course/);
    });

    it('and handleEnroll — which was always right — is untouched', () => {
        // Nothing was migrated for tidiness. It was not the defect; it is the
        // evidence that the other path was one.
        expect(code(PAGE)).toMatch(/showToast\(result\.error \|\| "Failed to enroll", "error"\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#315 — the premise: the action really does distinguish two refusals', () => {
    /**
     * Checked, not assumed. If these two messages ever collapse back into one,
     * the reason for surfacing them is weaker and this failing says so.
     */
    it('names the package the learner HOLDS when they hold one', () => {
        expect(code(ACTION)).toMatch(/does not grant access to this course/);
    });

    it('and says something different when they hold none at all', () => {
        expect(code(ACTION)).toMatch(/does not include a course package yet/);
    });

    it('both reach the caller as `error`, not as a thrown string swallowed inside', () => {
        // The action throws inside its transaction and converts to
        // { success: false, error: message } in the catch. That conversion is
        // what makes the fix above possible.
        const src = code(ACTION);

        expect(src).toMatch(/return \{ success: false as const, error: error instanceof Error \? error\.message/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#315 — the stale-session gap that makes it reachable', () => {
    it('the page gate reads the SESSION plan; the action reads the live row', () => {
        // Recorded rather than changed: closing the gap means re-reading the
        // user row in the browser on every course open, which is a caching
        // decision, not a defect fix. What was a defect is saying nothing when
        // the two disagree.
        expect(code(PAGE)).toMatch(/session\.user as any\)\?\.serviceRegistrations\?\.academy\?\.plan/);
        expect(code(ACTION)).toMatch(/userData/);
    });
});
