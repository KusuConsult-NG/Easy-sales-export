/**
 * @jest-environment jsdom
 */

/**
 *   #717 NINE ERROR BOUNDARIES RELOADED THE PAGE AUTOMATICALLY AND NOTHING
 *   COUNTED THE RELOADS.
 *
 *   Each held its own copy of the same predicate and the same two lines:
 *
 *       if (isStaleDeploymentError(error)) {
 *           console.warn("Stale deployment detected — auto-reloading.");
 *           window.location.reload();
 *           return;
 *       }
 *
 *   THE RECOVERY IS RIGHT. A browser holding a page from the previous build
 *   asks for a chunk that is gone, and fetching the page again fixes it. That
 *   is why it was written, and the owner's own production log carries the
 *   condition it was written for:
 *
 *       Error: Failed to find Server Action "7fedf0299b…". This request might
 *       be from an older or newer deployment.
 *
 *   IT JUST DOES NOT TERMINATE. The reload only helps if it fetches a NEWER
 *   page than the one that failed. When it does not — an edge or browser cache
 *   still serving the old HTML shell, a rolling deploy where some instances
 *   answer with the previous build, a back/forward restore — the new page
 *   references the same missing chunk, throws the same error, reaches the same
 *   boundary, and reloads again. There was no counter, no timestamp and no
 *   bound anywhere in any of the nine.
 *
 *   What that costs is a tab nobody can read or use, showing "Updating to
 *   latest version…" and re-requesting the page as fast as it can load it, for
 *   as long as it stays open — worst during a deployment, which is exactly
 *   when the condition that starts it is most likely.
 *
 *   AND THE SERVER-ACTION CASE IS NOT THE ONE THAT SPINS. That one needs a
 *   click, so it cannot repeat on its own. `ChunkLoadError` and "Failed to
 *   fetch dynamically imported module" fire during RENDER with no user
 *   involved. Those loop.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';
import {
    isStaleDeploymentError,
    canAutoReload,
    consumeReloadBudget,
    clearReloadBudget,
    RELOAD_BUDGET,
    RESET_AFTER_MS,
} from '@/lib/stale-deployment-recovery';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

beforeEach(() => {
    window.sessionStorage.clear();
    clearReloadBudget();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#717 — the reload is bounded', () => {
    it('THE FIRST TWO ARE ALLOWED AND THE THIRD IS NOT', () => {
        //   THE defect, directly. Before this, every call returned "reload".
        expect(consumeReloadBudget()).toBe(true);
        expect(consumeReloadBudget()).toBe(true);
        expect(consumeReloadBudget()).toBe(false);
        expect(consumeReloadBudget()).toBe(false);
    });

    it('AND THE BUDGET IS WHAT THE MODULE SAYS IT IS', () => {
        //   Derived from the constant rather than hardcoded, so raising the
        //   budget stays a one-line change and cannot silently disagree with
        //   its own test.
        for (let i = 0; i < RELOAD_BUDGET; i += 1) expect(consumeReloadBudget()).toBe(true);
        expect(consumeReloadBudget()).toBe(false);
    });

    it('AND canAutoReload ONLY LOOKS — IT DOES NOT SPEND', () => {
        /*
         *   The split exists so a boundary can decide what to RENDER without
         *   consuming anything. If peeking spent, the budget would be gone
         *   before the effect that performs the reload ever ran, and the page
         *   would show "Updating…" while never reloading.
         */
        expect(canAutoReload()).toBe(true);
        expect(canAutoReload()).toBe(true);
        expect(canAutoReload()).toBe(true);
        expect(consumeReloadBudget()).toBe(true);
        expect(consumeReloadBudget()).toBe(true);
        expect(canAutoReload()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#717 — and a bound that never lifts is its own bug', () => {
    it('A FAILURE LONG AFTER THE LAST ONE IS A NEW INCIDENT', () => {
        /*
         *   A budget that is spent once and never refilled would mean the
         *   THIRD deployment in a browsing session stops auto-recovering for
         *   good — trading an infinite loop for a permanently degraded
         *   recovery, which is a worse bargain than it looks.
         */
        const t0 = 1_000_000;
        expect(consumeReloadBudget(t0)).toBe(true);
        expect(consumeReloadBudget(t0 + 1_000)).toBe(true);
        expect(consumeReloadBudget(t0 + 2_000)).toBe(false);

        //   Long enough later, this is a different deployment, not a loop.
        //
        //   Measured from the last RECORDED attempt (t0 + 1_000), not from the
        //   refusal at t0 + 2_000 — a refusal writes nothing, so it cannot
        //   extend the incident it just declined to serve. Getting this
        //   arithmetic wrong is what the first version of this test did.
        expect(consumeReloadBudget(t0 + 1_000 + RESET_AFTER_MS + 1)).toBe(true);
    });

    it('AND A DIFFERENT PAGE GETS ITS OWN BUDGET', () => {
        //   Two pages failing is two incidents. One page failing three times
        //   is a loop. Without the path in the key, one bad route would spend
        //   the budget of every page the person visited afterwards.
        expect(consumeReloadBudget()).toBe(true);
        expect(consumeReloadBudget()).toBe(true);
        expect(consumeReloadBudget()).toBe(false);

        window.history.pushState({}, '', '/somewhere-else');
        expect(consumeReloadBudget()).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#717 — with nowhere to keep the count, it does not start a loop', () => {
    it('NO USABLE sessionStorage MEANS NO AUTOMATIC RELOAD', () => {
        /*
         *   A private window with site data blocked. There is no way to count,
         *   so the choice is between an unbounded automatic reload and none.
         *
         *   IT TAKES NONE, and that is the whole argument of this finding: an
         *   automatic reload that cannot be bounded is the failure being
         *   removed. The boundary's own error screen still carries "Try again",
         *   so the person recovers in one click instead of never.
         */
        const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
        Object.defineProperty(window, 'sessionStorage', {
            configurable: true,
            get() { throw new DOMException('The operation is insecure.'); },
        });

        try {
            expect(canAutoReload()).toBe(false);
            expect(consumeReloadBudget()).toBe(false);
        } finally {
            if (original) Object.defineProperty(window, 'sessionStorage', original);
        }
    });

    it('AND A CORRUPT RECORD IS TREATED AS SPENT, NOT AS EMPTY', () => {
        //   Reading unparseable JSON as "no reloads yet" would hand out the
        //   budget again on every single pass, which IS the loop — arrived at
        //   through the error path instead of the happy one.
        window.sessionStorage.setItem('esx:stale-deployment-reloads', '{not json');
        expect(consumeReloadBudget()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#717 — the predicate still recognises what it always did', () => {
    it('EVERY MESSAGE THE NINE COPIES MATCHED', () => {
        //   This finding is about the reload, not the predicate. The list is
        //   carried over unchanged, and pinned so consolidating nine copies
        //   into one cannot quietly drop a case.
        for (const msg of [
            'Failed to find Server Action "7fedf0299b2efcdfcefab9ae7f286937331404e2ed"',
            'This request might be from an older or newer deployment',
            'Loading chunk 4711 failed',
            'ChunkLoadError',
            'was not found on the server',
            'UnrecognizedAction',
            'Failed to fetch dynamically imported module',
            'Importing a module script failed',
        ]) {
            expect(isStaleDeploymentError({ message: msg })).toBe(true);
        }

        expect(isStaleDeploymentError({ name: 'ChunkLoadError' })).toBe(true);
        expect(isStaleDeploymentError({ name: 'UnrecognizedActionError' })).toBe(true);
    });

    it('AND AN ORDINARY ERROR IS NOT ONE', () => {
        //   The direction that matters more: a genuine fault misread as a
        //   stale bundle gets reloaded instead of reported, and the reload
        //   hides it.
        expect(isStaleDeploymentError(new Error('Insufficient balance'))).toBe(false);
        expect(isStaleDeploymentError(new Error(''))).toBe(false);
    });

    it('AND IT SURVIVES BEING HANDED SOMETHING THAT IS NOT AN ERROR', () => {
        //   A boundary can be given a string, null, or a plain object. A
        //   predicate that throws while deciding how to recover from an error
        //   is its own outage.
        expect(isStaleDeploymentError(null)).toBe(false);
        expect(isStaleDeploymentError(undefined)).toBe(false);
        expect(isStaleDeploymentError('ChunkLoadError')).toBe(false);
        expect(isStaleDeploymentError({ message: 42 })).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#717 — and no boundary reloads on its own again', () => {
    /*
     *   THE RATCHET. Nine copies existed because each was written separately,
     *   and nothing stopped a tenth. This audit's most frequent finding is a
     *   correct rule reaching some of the places it names; the cheapest defence
     *   is a test that reads the tree rather than a list somebody maintains.
     */

    const BOUNDARIES = [
        'src/app/error.tsx',
        'src/app/global-error.tsx',
        'src/app/admin/error.tsx',
        'src/app/farm-nation/error.tsx',
        'src/app/marketplace/error.tsx',
        'src/app/export/error.tsx',
        'src/app/cooperatives/onboarding/error.tsx',
        'src/app/wave/application/error.tsx',
        'src/components/ErrorBoundary.tsx',
    ];

    it('THE PREDICATE EXISTS IN EXACTLY ONE PLACE', () => {
        for (const rel of BOUNDARIES) {
            expect(code(rel)).not.toContain('function isStaleDeploymentError');
        }
        expect(code('src/lib/stale-deployment-recovery.ts'))
            .toContain('export function isStaleDeploymentError');
    });

    it('AND NOT ONE OF THEM CALLS reload() WITHOUT SPENDING BUDGET FIRST', () => {
        /*
         *   The assertion that would have caught the original defect. It looks
         *   at what reaches a reload, not at whether the file mentions the
         *   budget somewhere — #704 and #707 both had a mutant survive on a
         *   file-level match that an import line satisfied.
         *
         *   A reload inside an onClick is a person pressing a button and is
         *   bounded by them getting bored; only automatic ones are counted.
         */
        //   Offenders are COLLECTED and asserted as a list rather than one
        //   expect() per file: a bare `expect(false).toBe(true)` names nothing,
        //   and jest's expect takes no message argument (that is vitest). The
        //   list is the diagnosis.
        const unguarded: string[] = [];

        for (const rel of BOUNDARIES) {
            const lines = code(rel).split('\n');

            lines.forEach((line, i) => {
                if (!line.includes('window.location.reload()')) return;
                //   A reload inside an onClick is a person pressing a button,
                //   bounded by them getting bored. Only automatic ones count.
                if (line.includes('onClick')) return;

                //   The guard must be within a few lines above the reload —
                //   close enough to be the thing that permits it. Deliberately
                //   NOT "does this file mention the budget": #704 and #707 both
                //   had a mutant survive a file-level match that the import
                //   line alone satisfied.
                const before = lines.slice(Math.max(0, i - 6), i).join('\n');
                if (!/consumeReloadBudget\(\)|useStaleDeploymentRecovery/.test(before)) {
                    unguarded.push(`${rel}:${i + 1}`);
                }
            });
        }

        expect(unguarded).toEqual([]);
    });

    it('AND EVERY ONE OF THEM GOES THROUGH THE SHARED RECOVERY', () => {
        const notUsingIt = BOUNDARIES.filter(
            (rel) => !/useStaleDeploymentRecovery|stale-deployment-recovery/.test(code(rel)),
        );
        expect(notUsingIt).toEqual([]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy.
 *
 *     MUTANT                                                        RESULT
 *     consumeReloadBudget always returns true — the defect            KILLED
 *     the budget is never written, so every call sees zero            KILLED
 *     the path is dropped from the key                                KILLED
 *     the RESET_AFTER_MS expiry is removed                            KILLED
 *     unusable sessionStorage falls through to "reload anyway"        KILLED
 *     a corrupt record is read as "no reloads yet"                    KILLED
 *     canAutoReload spends instead of peeking                         KILLED
 *     the predicate drops the Server Action case                      KILLED
 *     the predicate throws on a non-Error                             KILLED
 *     one boundary goes back to an unguarded reload                   KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 */
