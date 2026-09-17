/**
 * @jest-environment node
 */

/**
 *   #852 SEVEN OF FIFTEEN ERROR BOUNDARIES WERE A DEAD END, AND WHICH SEVEN
 *   DECIDED WHETHER A MEMBER GOT HER WORK BACK.
 *
 *   Next's own shipped documentation — node_modules/next/dist/docs, which
 *   AGENTS.md requires reading before writing code against this version —
 *   prescribes THREE remedies for "Failed to find Server Action":
 *
 *       1. deploymentId, for version skew        (#836, inert until #851
 *                                                 declared its ARG)
 *       2. a stable NEXT_SERVER_ACTIONS_ENCRYPTION_KEY across instances
 *                                                (#836, same)
 *       3. "Surface the error as a retry path in the UI rather than a hard
 *          failure, so a refresh recovers the user."
 *
 *   The third is the one that holds when the other two are perfect, and the
 *   docs say why in the same section:
 *
 *       "New deployments typically generate new IDs (Next.js rotates them at
 *        most every 14 days, even when the source is unchanged), so a client
 *        still running the previous build may invoke an action ID that no
 *        longer exists."
 *
 *   A tab left open across a rotation meets this whatever the configuration is.
 *
 * ── AND THE RECOVERY ALREADY EXISTED, IN EIGHT OF FIFTEEN PLACES ────────────
 *
 *   #717 built `useStaleDeploymentRecovery` and described it in its own words
 *   as "one shared, bounded recovery instead of nine copies of the same
 *   unguarded reload". Measured before this finding:
 *
 *       route boundaries       8 of 15 had it
 *       class boundaries       1 of 4  had it
 *
 *   THE NEAREST BOUNDARY WINS, which is what makes the gap specific rather than
 *   statistical:
 *
 *       /wave/application        recovered
 *       /wave                    dead end
 *       /cooperatives/onboarding recovered
 *       /cooperatives            dead end
 *
 *   So a WAVE applicant mid-form was carried through a rotation and a WAVE
 *   member on any other page of the same programme was shown "Something went
 *   wrong!" with no way forward. That is #838's shape — one of two screens
 *   having the rule — on the screen where losing it costs somebody her work.
 *
 * ── WHY THIS SUITE DISCOVERS THE BOUNDARIES RATHER THAN LISTING THEM ────────
 *
 *   A hand-written list is how eight became eight. The sweep below finds every
 *   boundary on disk, so a new `error.tsx` added tomorrow without the recovery
 *   fails here — which is the only version of this test that could have caught
 *   the defect it is written about.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** Every file under a directory, recursively, as repo-relative paths. */
const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = join(dir, entry);
        if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
        else out.push(relative('', rel));
    }
    return out;
};

/** Next's route-level boundaries: error.tsx / global-error.tsx under app/. */
const routeBoundaries = (): string[] =>
    walk('src/app')
        .filter((f) => /(^|\/)(error|global-error)\.tsx$/.test(f))
        .sort();

/** React class boundaries anywhere in src/ — they cannot use the hook. */
const classBoundaries = (): string[] =>
    walk('src')
        .filter((f) => f.endsWith('.tsx') && !f.includes('__tests__'))
        .filter((f) => code(f).includes('componentDidCatch('))
        .sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#852 — every error boundary can recover from a rotated action id', () => {
    it('THE SWEEP FINDS BOUNDARIES AT ALL — the vacuity guard', () => {
        /*
         *   The assertions below are "this list has no exceptions", and an
         *   empty list has none. A `walk` that silently returned nothing —
         *   a renamed directory, a changed extension — would report perfect
         *   coverage of zero files.
         */
        expect(routeBoundaries().length).toBeGreaterThanOrEqual(15);
        expect(classBoundaries().length).toBeGreaterThanOrEqual(4);
    });

    it('THE REPORTED GAP: every ROUTE boundary uses the shared hook', () => {
        const missing = routeBoundaries()
            .filter((f) => !code(f).includes('useStaleDeploymentRecovery'));

        expect(missing).toEqual([]);
    });

    it('AND EVERY CLASS BOUNDARY USES THE SAME RULE, by the other plumbing', () => {
        /*
         *   A class component cannot call a hook, so it consults
         *   `isStaleDeploymentError` and spends `consumeReloadBudget` directly —
         *   the arrangement ErrorBoundary already used. Asserted on the RULE,
         *   not on the hook, because requiring the hook here would be requiring
         *   the plumbing and would fail against correct code.
         */
        const missing = classBoundaries()
            .filter((f) => !code(f).includes('isStaleDeploymentError'));

        expect(missing).toEqual([]);
    });

    it('AND THE TWO PAIRS THAT PROVED IT MATTERS ARE BOTH COVERED', () => {
        /*
         *   Named, because the sweep above would pass if somebody deleted the
         *   uncovered files. These are the specific dead ends: the nearest
         *   boundary wins, so the parent route's boundary is what a member on
         *   any other page of that programme actually meets.
         */
        for (const pair of [
            ['src/app/wave/error.tsx', 'src/app/wave/application/error.tsx'],
            ['src/app/cooperatives/error.tsx', 'src/app/cooperatives/onboarding/error.tsx'],
        ]) {
            for (const f of pair) {
                expect({ f, recovers: code(f).includes('useStaleDeploymentRecovery') })
                    .toEqual({ f, recovers: true });
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#852 — and the recovery is bounded, which is the half that must not regress', () => {
    /**
     *   #717's finding was an UNGUARDED `window.location.reload()`, nine times
     *   over: when a reload does not fetch a newer page — an edge cache still
     *   holding the old shell, a rolling deploy, a back/forward restore — the
     *   same error reaches the same boundary and reloads again, forever. Adding
     *   the recovery to seven more boundaries is adding seven more chances to
     *   re-create it.
     */
    it('NO BOUNDARY RELOADS WITHOUT SPENDING THE BUDGET FIRST', () => {
        const offenders: string[] = [];

        for (const f of [...routeBoundaries(), ...classBoundaries()]) {
            const src = code(f);
            let from = 0;
            for (;;) {
                const at = src.indexOf('window.location.reload()', from);
                if (at === -1) break;
                from = at + 1;

                /*
                 *   A reload is legitimate when it is the budget's, or when a
                 *   PERSON asked for it — every one of these screens has a "Try
                 *   again" button, and a reload somebody clicked cannot loop.
                 *   Judged on the 400 characters before the call, which is where
                 *   either guard sits.
                 */
                const before = src.slice(Math.max(0, at - 400), at);
                const guarded = before.includes('consumeReloadBudget')
                    || /handle\w*(Reset|Retry|Reload)\s*=|onClick/.test(before);

                if (!guarded) offenders.push(f);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('AND THE SHARED HOOK STILL SPENDS IT, so the guard is not decorative', () => {
        //   If the hook stopped consuming, every boundary above would be
        //   unbounded again and this file would still be green.
        //   `.ts`, not `.tsx` — it renders nothing, it returns a boolean. The
        //   first version of this line guessed the extension from the directory
        //   it sits in and read a file that does not exist.
        const hook = code('src/components/shared/useStaleDeploymentRecovery.ts');

        expect(hook).toContain('consumeReloadBudget()');
        expect(hook).toContain('isStaleDeploymentError(error)');
    });

    it('AND AN EXHAUSTED BUDGET FALLS THROUGH TO A SCREEN WITH A WAY OUT', () => {
        /*
         *   The behaviour Next's docs actually ask for — "a retry path in the
         *   UI rather than a hard failure". A boundary that rendered the
         *   "Updating…" notice when it was NOT reloading would be a spinner
         *   that never resolves, which is worse than the error it replaced.
         *
         *   The hook returns false in that case; each boundary must gate its
         *   notice on the return value rather than on the error's identity.
         */
        for (const f of routeBoundaries()) {
            const src = code(f);
            const at = src.indexOf('Updating to latest version');
            if (at === -1) continue;

            const before = src.slice(Math.max(0, at - 400), at);
            expect({ f, gated: /if\s*\(\s*updating\s*\)/.test(before) })
                .toEqual({ f, gated: true });
        }
    });
});
