/**
 * @jest-environment node
 */

/**
 *   #855 "AN ERROR OCCURRED. PLEASE TRY AGAIN" — ADVICE THAT COULD NOT WORK, ON
 *   THE SCREENS WHERE FAILING COSTS THE MOST.
 *
 *   THE OWNER: "on farm nation onboarding why do you have this error: When
 *   onboarding a buyer 'An error occurred. Please try again'?"
 *
 * ── WHAT THE MEASUREMENT SAID, AND WHAT IT RULED OUT ────────────────────────
 *
 *   The sentence is the CLIENT's catch — FarmNationOnboardingClient, the
 *   `catch (error)` around the submit. It is not the server's, which says
 *   "An error occurred while processing your onboarding".
 *
 *   And a server-side throw CANNOT REACH IT. `withFlexibleSafeAction` catches
 *   everything except NEXT_REDIRECT and NEXT_NOT_FOUND and returns
 *   `{ success: false, error }`, which the screen renders as `result.error`. So
 *   whatever produced that toast happened to the REQUEST, not inside the
 *   action.
 *
 *   The buyer payload was then executed against the real action, field for
 *   field as InterestsStep builds it — see farm-nation-onboarding-behaviour,
 *   "AND ACCEPTS WHAT THE BUYER FORM ACTUALLY SENDS". It returns success,
 *   grants `investor`, writes the application and keeps her answers. THE
 *   SUBMISSION WAS NEVER THE PROBLEM.
 *
 *   That leaves the transport — and the owner's production log is full of it:
 *
 *       Failed to find Server Action "7f183577e1306597…"   (x5)
 *       Failed to find Server Action "7f6f412017f9948c…"   (x9)
 *
 *   NOT CLAIMED AS PROVEN. Their session is not reproducible from here and the
 *   log does not carry that request. What IS established: the payload is
 *   accepted, a server throw cannot produce that sentence, and a stale action
 *   id produces exactly it.
 *
 * ── WHY #852 DOES NOT COVER THIS, WHICH IS THE FINDING ──────────────────────
 *
 *   #852 put the bounded recovery on all nineteen error boundaries. NOT ONE OF
 *   THEM CAN HELP HERE. React error boundaries catch errors thrown during
 *   RENDER; a rejected promise inside an async event handler is caught by the
 *   handler's own `catch` and never reaches a boundary at all.
 *
 *   So the module that knows how to recognise this failure was wired to every
 *   place that cannot see it, and to none of the places that can. Every
 *   "Submit" button in the application is one of the latter.
 *
 *   And the advice was worse than unhelpful: trying again re-posts the same
 *   dead action id from the same loaded page and fails identically, for as long
 *   as she keeps trying. On the academy payment path she is invited to keep
 *   pressing a button that will never take her money.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    isStaleDeploymentError,
    staleSubmitAdvice,
    STALE_SUBMIT_ADVICE,
} from '@/lib/stale-deployment-recovery';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

/**
 * Every screen where a member fills a form in and presses submit.
 *
 * Enumerated rather than swept, and that is a deliberate narrowing: 82 sites in
 * `src/app` show a generic message from a catch, and most are right to — a
 * genuine unexpected error IS unexpected. These six are the ones where the cost
 * of "try again" being impossible is a multi-step form, an application to a
 * programme, or a payment.
 */
const SUBMIT_SCREENS = [
    'src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx',
    'src/app/cooperatives/onboarding/OnboardingClient.tsx',
    'src/app/export/onboarding/ExportOnboardingClient.tsx',
    'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx',
    'src/app/wave/application/WaveApplicationClient.tsx',
    'src/app/academy/application/AcademyApplicationClient.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#855 — the failure is recognised where it actually lands', () => {
    it('THE REPORTED CASE: a stale action id gets advice that can work', () => {
        /*
         *   The production message, verbatim from the owner's log. Executed
         *   against the real predicate rather than asserted about it.
         */
        const err = new Error(
            'Failed to find Server Action "7f183577e13065975f65e247a7557b8bd4aeb470f7". '
            + 'This request might be from an older or newer deployment.',
        );

        expect(isStaleDeploymentError(err)).toBe(true);
        expect(staleSubmitAdvice(err)).toBe(STALE_SUBMIT_ADVICE);
    });

    it('AND THE ADVICE SAYS REFRESH, not "try again"', () => {
        /*
         *   The whole point. "Please try again" re-posts the same dead action id
         *   from the same loaded page — it is not merely unhelpful, it is the
         *   one thing that cannot work.
         */
        expect(STALE_SUBMIT_ADVICE).toMatch(/refresh/i);
        expect(STALE_SUBMIT_ADVICE).toMatch(/trying again will not/i);
    });

    it('AND AN ORDINARY FAILURE KEEPS THE SCREEN\'S OWN WORDING', () => {
        /*
         *   `null`, not a generic sentence, so a caller is never given a message
         *   about deployments for a failure that has nothing to do with one. A
         *   helper that answered for everything would make every error on these
         *   six screens say "refresh the page".
         */
        for (const e of [
            new Error('Network request failed'),
            new Error('insufficient funds'),
            new TypeError('x is not a function'),
            null,
            undefined,
            'a string',
        ]) {
            expect({ e: String(e), advice: staleSubmitAdvice(e) })
                .toEqual({ e: String(e), advice: null });
        }
    });

    it('AND THE CHUNK-LOAD SPELLINGS ARE COVERED TOO', () => {
        //   The same incident arrives under several names depending on which
        //   asset the stale page reached for first.
        for (const msg of [
            'Loading chunk 47661 failed',
            'Failed to fetch dynamically imported module',
            'This request might be from an older or newer deployment.',
        ]) {
            expect({ msg, stale: isStaleDeploymentError(new Error(msg)) })
                .toEqual({ msg, stale: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#855 — and every submit screen uses it', () => {
    it('ALL SIX CONSULT staleSubmitAdvice IN THEIR CATCH', () => {
        const missing = SUBMIT_SCREENS.filter((f) => !code(f).includes('staleSubmitAdvice(error)'));
        expect(missing).toEqual([]);
    });

    it('AND EACH KEEPS ITS OWN MESSAGE AS THE FALLBACK', () => {
        /*
         *   `?? existing` rather than a replacement. Six screens all saying one
         *   sentence for every failure would lose the specific wording each has
         *   for its own — the academy payment path, for instance, says the
         *   payment did not start.
         */
        const bare = SUBMIT_SCREENS.filter((f) => {
            const src = code(f);
            let from = 0;
            for (;;) {
                const at = src.indexOf('staleSubmitAdvice(error)', from);
                if (at === -1) return false;
                from = at + 1;
                if (!src.slice(at, at + 200).includes('??')) return true;
            }
        });

        expect(bare).toEqual([]);
    });

    it('AND THE ACADEMY PAYMENT PATH IS ONE OF THEM', () => {
        /*
         *   Named because it is the worst case and the easiest to miss: it is a
         *   SECOND catch in a file whose other catch was already wired, which is
         *   exactly the "one of two" shape this audit keeps finding.
         */
        const src = code('src/app/academy/application/AcademyApplicationClient.tsx');
        const at = src.indexOf('Payment initiation error');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 300)).toContain('staleSubmitAdvice(error)');
    });

    it('AND THE RENDER-PATH RECOVERY IS UNTOUCHED — #852 must still hold', () => {
        /*
         *   The two halves are different mechanisms for different failures and
         *   both are needed: a boundary cannot see a submit, and a submit
         *   handler is not reached when a render throws. A change that unified
         *   them would quietly drop one.
         */
        const hook = code('src/components/shared/useStaleDeploymentRecovery.ts');

        expect(hook).toContain('isStaleDeploymentError(error)');
        expect(hook).toContain('consumeReloadBudget()');
    });

    it('AND THE SUBMIT PATH DOES NOT RELOAD BY ITSELF', () => {
        /*
         *   The judgement, pinned. The render path reloads because nothing is
         *   being typed into a screen that has already failed. A submit is the
         *   opposite: she has just filled in a multi-step form, and some of
         *   these wizards keep a draft while others do not — reloading on her
         *   behalf would rescue the ones that do and silently discard the rest.
         *
         *   So she is told, and left holding the decision. A later change to
         *   reload here should be somebody's choice, not an edit.
         */
        for (const f of SUBMIT_SCREENS) {
            const src = code(f);
            const at = src.indexOf('staleSubmitAdvice(error)');
            expect({ f, reloads: src.slice(at, at + 300).includes('location.reload') })
                .toEqual({ f, reloads: false });
        }
    });
});
