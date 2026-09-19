/**
 * @jest-environment node
 */

/**
 *   #892 #893 THE SAME SCREEN TWICE, AND ONLY ONE OF EACH PAIR WAS RIGHT.
 *
 *   The owner: "continue the audit, don't stop until everything is fixed", and
 *   "you are yet to fix all the issues with farm nation". So Farm Nation was
 *   swept rather than waited on, by comparing each screen with the sibling that
 *   does the same job in another module. Both findings below are a pair where
 *   one member was correct and the other was not.
 *
 * ── #892 MY PURCHASES, WHICH IS MY PROPERTIES FOR THE BUYER ─────────────────
 *
 *   #886 found My Properties telling a seller "No Listings Found" when the read
 *   had FAILED: `error` and `setError` declared, a red banner written and
 *   wired, and NOTHING anywhere calling setError. That was reported as a bug on
 *   one page, so one page was fixed.
 *
 *   My Purchases is the same three defects on the other side of the same
 *   module, and it costs more. Its empty state reads "No Purchase Requests —
 *   Browse available properties and make your first purchase request", above a
 *   button that goes and does it. A buyer who has already reserved or paid for
 *   a parcel, and whose read merely failed, is invited to buy it again.
 *
 * ── #893 A GATE ONE BRACE TOO DEEP, AND ITS SIBLING SHOWS THE SHAPE ─────────
 *
 *   The cooperative onboarding form had:
 *
 *       if (isCheckingStatus) {
 *           if (loadFailed) { return <ListLoadFailed …/>; }
 *           return <spinner/>;
 *       }
 *
 *   The failure screen could only render while the status check was still
 *   considered to be running. It worked BY ACCIDENT: all three
 *   `setLoadFailed(true)` sites returned without clearing `isCheckingStatus`,
 *   so the flag gating the failure screen was the flag nobody cleared. Two
 *   coincidences holding each other up — clear `isCheckingStatus` anywhere near
 *   a failure and the member gets a spinner for ever instead of the screen
 *   written for her.
 *
 *   FarmNationOnboardingClient — the same form for the other module — has it
 *   the right way round: `loadFailed` at the top level, the spinner after it,
 *   and failure sites that write `setLoadFailed(true); setIsLoading(false);`.
 *   The cooperative now matches, in both halves, so neither depends on the
 *   other being forgotten.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const MY_PURCHASES = 'src/app/farm-nation/(member)/my-purchases/MyPurchasesClient.tsx';
const MY_PROPERTIES = 'src/app/farm-nation/(member)/my-properties/page.tsx';
const COOP_ONBOARDING = 'src/app/cooperatives/onboarding/OnboardingClient.tsx';
const FN_ONBOARDING = 'src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#892 — the buyer is told the truth about a failed read', () => {
    it('THE DEFECT: the failed branch now reaches setError', () => {
        const src = code(MY_PURCHASES);

        expect(src).toContain('setError(');
        expect(src).toMatch(/else\s*\{[\s\S]{0,400}setError\(/);
    });

    it('AND THE SPINNER HAS AN EXIT', () => {
        const src = code(MY_PURCHASES);
        const at = src.indexOf('if (!session?.user)');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 120)).toContain('setLoading(false)');
    });

    it('AND "MAKE YOUR FIRST PURCHASE" IS NOT SHOWN UNDER A FAILURE', () => {
        /*
         *   The half that matters most here. The invitation below the empty
         *   state is an invitation to pay for a parcel the buyer may already
         *   have paid for.
         */
        expect(code(MY_PURCHASES))
            .toContain('error && filteredPurchases.length === 0 ? null');
    });

    it('AND THE BANNER OFFERS A WAY OUT', () => {
        const src = code(MY_PURCHASES);
        const at = src.indexOf('{error && (');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 1000)).toContain('Try again');
    });

    it('AND A FAILED REFRESH DOES NOT BLANK THE LIST', () => {
        const src = code(MY_PURCHASES);
        const at = src.indexOf('async function loadPurchases');
        const body = src.slice(at, at + 1400);

        expect(body).not.toContain('setPurchases([])');
    });

    it('AND BOTH SIDES OF THE MODULE NOW AGREE — the pair, checked as a pair', () => {
        /*
         *   The point of this suite. #886 fixed one of two screens that do the
         *   same job; asserting them together is what stops the next fix
         *   reaching one again.
         */
        for (const rel of [MY_PURCHASES, MY_PROPERTIES]) {
            const src = code(rel);
            expect({ rel, reportsFailure: /else\s*\{[\s\S]{0,400}setError\(/.test(src) })
                .toEqual({ rel, reportsFailure: true });
            expect({ rel, exclusive: /error && filtered\w+\.length === 0 \? null/.test(src) })
                .toEqual({ rel, exclusive: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#893 — the failure screen is reachable', () => {
    it('THE DEFECT: loadFailed is checked BEFORE the spinner, not inside it', () => {
        /*
         *   Position is the whole finding. Nested, the failure screen renders
         *   only while `isCheckingStatus` is still true.
         */
        const src = code(COOP_ONBOARDING);
        const failAt = src.indexOf('if (loadFailed) {');
        const spinAt = src.indexOf('if (isCheckingStatus) {');

        expect(failAt).toBeGreaterThan(-1);
        expect(spinAt).toBeGreaterThan(-1);
        expect(failAt).toBeLessThan(spinAt);
    });

    it('AND THE SPINNER BLOCK NO LONGER CONTAINS THE FAILURE GATE', () => {
        //   The direct statement of "one brace too deep".
        const src = code(COOP_ONBOARDING);
        const spinAt = src.indexOf('if (isCheckingStatus) {');

        expect(src.slice(spinAt, spinAt + 400)).not.toContain('loadFailed');
    });

    it('AND EVERY FAILURE SITE CLEARS THE CHECKING FLAG', () => {
        /*
         *   The second half. Hoisting the gate alone would leave the screen
         *   correct and the flag still stuck — and the next person to read
         *   `isCheckingStatus` would meet a value that never becomes false.
         */
        /*
         *   READ AS A BLOCK, NOT AS A LINE. The first version matched
         *   `setLoadFailed(true)` to the end of its own line, which worked while
         *   every site was a one-liner and broke the moment #896 added a
         *   multi-line catch that does the same two things across two lines. The
         *   property is "this site clears the flag", not "it fits on one line".
         */
        const src = code(COOP_ONBOARDING);
        const sites = [...src.matchAll(/setLoadFailed\(true\)/g)];

        expect(sites.length).toBeGreaterThanOrEqual(3);
        for (const m of sites) {
            const after = src.slice(m.index ?? 0, (m.index ?? 0) + 160);
            expect({ after: after.slice(0, 60), clears: after.includes('setIsCheckingStatus(false)') })
                .toMatchObject({ clears: true });
        }
    });

    it('AND THE SIBLING THAT WAS ALWAYS RIGHT STILL IS — the control', () => {
        /*
         *   FarmNationOnboardingClient is where the correct shape was found. If
         *   this ever fails, the pair drifted again in the other direction.
         */
        const src = code(FN_ONBOARDING);
        const failAt = src.indexOf('if (loadFailed) {');
        const spinAt = src.indexOf('if (isLoading) {');

        expect(failAt).toBeGreaterThan(-1);
        expect(spinAt).toBeGreaterThan(-1);
        expect(failAt).toBeLessThan(spinAt);
    });

    it('AND BOTH FORMS STILL RENDER A FAILURE SCREEN AT ALL', () => {
        //   Vacuity guard: an ordering assertion passes trivially if neither
        //   branch exists.
        for (const rel of [COOP_ONBOARDING, FN_ONBOARDING]) {
            expect({ rel, has: code(rel).includes('ListLoadFailed') })
                .toEqual({ rel, has: true });
        }
    });
});
