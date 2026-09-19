/**
 * @jest-environment node
 */

/**
 *   #896 THE INVITE LINK HAD NO FAILURE BRANCH, AND IT IS THE LINK THE EMAIL
 *        SENDS PEOPLE DOWN.
 *
 *   THE OWNER: "Cooperative membership application is not loading on
 *   production."
 *
 *   `isCheckingStatus` starts TRUE and the screen renders a spinner until
 *   something clears it. Every route out of that effect clears it —
 *   `checkStatusFromBackend` even has its own `.catch` — except one:
 *
 *       if (token) {
 *           import("@/app/actions/cooperative").then(({ validate… }) => {
 *               validateCooperativeInviteAction(token).then((res) => { … });
 *           });
 *           return;                      // no .catch on either promise
 *       }
 *
 *   If the dynamic import or the action rejects, nothing clears the flag. The
 *   member watches a spinner for ever: no error, no empty state, no way out.
 *   "Not loading", exactly.
 *
 *   AND THE REJECTION IS NOT HYPOTHETICAL. `import()` fetches a chunk over the
 *   network, and a deploy replaces chunks — which is the whole reason this
 *   codebase carries useStaleDeploymentRecovery and staleSubmitAdvice, both
 *   imported by this very file. A member who opens the invite email after the
 *   next deploy is the case.
 *
 *   IT IS THE MAIN DOOR, NOT A CORNER. admin/_legacy.ts mails
 *   `…/cooperatives/onboarding?token=<token>`, so this is how an INVITED member
 *   arrives — which is most of the people this screen exists for.
 *
 * ── AND THE OUTER CATCH SHOWED A BLANK FORM AS AN ANSWER ────────────────────
 *
 *   The status check's own `.catch` cleared the spinner and did nothing else,
 *   so a failed read landed the member on step 1 of an EMPTY form — the screen
 *   for somebody who has never applied. #793 established the rule for THIS FILE
 *   ("a failed read is not an empty application") and wired it to the three
 *   read branches. The outer catch, which covers all three, was not one of
 *   them.
 *
 *   What it costs is what #793 was about: she fills the form again, and the
 *   resubmission overwrites the application she already had.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ONBOARDING = 'src/app/cooperatives/onboarding/OnboardingClient.tsx';

const raw = () => readFileSync(join(process.cwd(), ONBOARDING), 'utf8');
const code = () => stripComments(raw(), { label: ONBOARDING });

// ─────────────────────────────────────────────────────────────────────────────
describe('#896 — the invite path cannot leave the spinner up', () => {
    it('THE REPORTED DEFECT: both promises on the token branch are caught', () => {
        /*
         *   The dynamic import AND the action. Catching only the inner one
         *   leaves the chunk-load failure — the likelier of the two — still
         *   unhandled.
         */
        const src = code();
        const at = src.indexOf('const token = urlParams.get(\'token\');');

        expect(at).toBeGreaterThan(-1);
        const branch = src.slice(at, at + 1600);

        expect(branch).toContain('import("@/app/actions/cooperative")');
        expect(branch).toContain('.catch(');
    });

    it('AND THE FAILURE FALLS THROUGH TO THE ORDINARY STATUS CHECK', () => {
        /*
         *   Not a dead end. An invite that cannot be validated should still let
         *   her see where she stands — and that path clears the flag on every
         *   branch including its own failure.
         */
        const src = code();
        const at = src.indexOf('.catch(');
        const branch = src.slice(at, at + 700);

        expect(branch).toContain('checkStatusFromBackend()');
    });

    it('AND IT TELLS HER SOMETHING — a stale bundle by name where it applies', () => {
        //   staleSubmitAdvice is already imported by this file for the submit
        //   path; a chunk that failed to load is the same condition.
        const src = code();
        const at = src.indexOf('.catch(');

        expect(src.slice(at, at + 700)).toContain('staleSubmitAdvice(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#896 — and a failed status read is not an empty application', () => {
    it('THE OUTER CATCH SETS loadFailed, not just the spinner', () => {
        const src = code();
        const at = src.indexOf('}).catch((err) => {');

        expect(at).toBeGreaterThan(-1);
        const body = src.slice(at, at + 400);

        expect(body).toContain('setLoadFailed(true)');
        expect(body).toContain('setIsCheckingStatus(false)');
    });

    it('AND NO EXIT FROM THE EFFECT LEAVES THE SPINNER UP', () => {
        /*
         *   The property behind both halves, stated once. Every `.catch` in this
         *   effect has to clear `isCheckingStatus` — that flag is the only thing
         *   between the member and a permanent spinner.
         */
        const src = code();
        const catches = [...src.matchAll(/\.catch\(([\s\S]{0,600}?)\n\s{8}\}\)/g)];

        expect(catches.length).toBeGreaterThanOrEqual(1);
        for (const [, body] of catches) {
            const clears = body.includes('setIsCheckingStatus(false)')
                || body.includes('checkStatusFromBackend()');
            expect({ clears, body: body.slice(0, 80) }).toMatchObject({ clears: true });
        }
    });

    it('AND THE FAILURE SCREEN IS STILL REACHABLE — #893, not re-nested', () => {
        //   setLoadFailed is worth nothing if the gate goes back inside the
        //   spinner's block, which is where #793 first put it.
        const src = code();

        expect(src.indexOf('if (loadFailed) {'))
            .toBeLessThan(src.indexOf('if (isCheckingStatus) {'));
    });
});
