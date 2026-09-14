/**
 * @jest-environment node
 */

/**
 *   #727 THE RATCHET THAT GUARANTEED EVERY CHECKOUT HAS A DOOR WAS LOOKING AT
 *        EIGHT OF THE ELEVEN.
 *
 *   #695 is one of this audit's most important findings: a checkout that takes
 *   money, fulfils nothing, and tells the buyer it worked. The suite written to
 *   stop it coming back opens by naming its own claim — "every checkout the
 *   platform mints must have a door that fulfils it" — and measures the types
 *   the checkouts mint against the types the router handles.
 *
 *   It measured them across a HAND-WRITTEN LIST of eight files, under a comment
 *   reading "the control below proves the list is complete".
 *
 *   THE CONTROL PROVES THE OPPOSITE DIRECTION. It asserts that every file on
 *   the list still mints something — that no entry has gone stale. Nothing
 *   anywhere asked whether the list covers every checkout.
 *
 * ── THREE CHECKOUTS WERE NOT ON IT ──────────────────────────────────────────
 *
 *   They do not call the shared initializer. They POST to Paystack's
 *   /transaction/initialize with their own fetch, so the scan could not see
 *   them however carefully it read the files it knew about:
 *
 *       src/app/actions/wallet.ts                    wallet_funding
 *       src/app/api/cooperative/contribute/route.ts  contribution
 *       src/app/api/cooperatives/register/route.ts   cooperative_membership_registration
 *
 *   ALL THREE MINT TYPES THE ROUTER HANDLES, and that is worth saying plainly:
 *   no payment is unfulfilled today and this finding repairs no live money
 *   defect. What it repairs is the GUARANTEE.
 *
 *   Measured rather than argued: pointing one of those three at a type no
 *   processor owns — the exact #695 defect, on a live money path — left that
 *   suite green at 32 passing. All three were re-probed after the repair and
 *   all three now fail it.
 *
 *   A ratchet that cannot fail on the thing it was written to catch is worse
 *   than no ratchet, because the next person reads the green and stops looking.
 *   That is the owner's whole complaint — a fix landing and the app breaking —
 *   in its most exact form.
 *
 * ── AND A SECOND verifyPaystackPayment, WHICH WAS THE WEAK ONE ──────────────
 *
 *   The same shape in the same surface. lib/paystack.ts — a "use client"
 *   module — exported a function named `verifyPaystackPayment`, marked
 *   "(Server-side)", reading PAYSTACK_SECRET_KEY. lib/paystack-SERVER.ts
 *   exports a function of that exact name which retries, throws when the secret
 *   is missing, and is the one every money path uses.
 *
 *   The client copy returned `{ success: false }` for every failure, including
 *   a missing secret — a verification that did not HAPPEN, reported in the same
 *   shape as one that ran and said no. That is #714's defect on a money path.
 *
 *   Nothing imported it, so it was a loaded trap rather than a live fault: one
 *   character of import path away from the real one, offered by the same
 *   autocomplete. Removed on #706's precedent, and pinned below at one.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import {
    checkoutFiles,
    checkoutSource,
    sourceFiles,
    callSpan,
} from '@/lib/testing/paystack-checkout-scan';

/*
 *   THE SWEEP IS THE SHARED ONE — lib/testing/paystack-checkout-scan.
 *
 *   The first draft of this finding defined the sweep here AND left a copy in
 *   #695's suite. Mutation testing killed that immediately: breaking one copy
 *   left the other suite green, which is this audit's most frequent defect
 *   reproduced inside its own repair. One implementation, both suites.
 */
const code = checkoutSource;

// ─────────────────────────────────────────────────────────────────────────────
describe('#727 — the checkouts that do not use the shared initializer', () => {
    it('THERE ARE THREE OF THEM, AND THEY ARE REAL MONEY PATHS', () => {
        /*
         *   THE finding, stated as the thing that was not true. Each of these
         *   POSTs to Paystack directly and mints a payment type, and none was
         *   on the eight-file list #695's suite measured.
         */
        const files = checkoutFiles();

        expect(files).toContain('src/app/actions/wallet.ts');
        expect(files).toContain('src/app/api/cooperative/contribute/route.ts');
        expect(files).toContain('src/app/api/cooperatives/register/route.ts');
    });

    it('AND THEY REACH PAYSTACK BY THE ENDPOINT, NOT THE HELPER — WHICH IS WHY THEY WERE INVISIBLE', () => {
        //   Vacuity guard on the claim above. If these had started calling
        //   initializePaystackPayment, the old scan would have seen them and
        //   this finding would be describing a problem that no longer exists.
        for (const rel of [
            'src/app/actions/wallet.ts',
            'src/app/api/cooperative/contribute/route.ts',
            'src/app/api/cooperatives/register/route.ts',
        ]) {
            const src = code(rel);
            expect(src).toContain('/transaction/initialize');
            expect(src).not.toContain('initializePaystackPayment(');
        }
    });

    it('AND THE SWEEP FINDS EVERY CHECKOUT, NOT A LIST SOMEBODY REMEMBERED TO UPDATE', () => {
        /*
         *   ELEVEN, not eight. Pinned as a floor rather than an equality: a
         *   twelfth checkout should make #695's suite ask who fulfils it, not
         *   fail here for existing.
         *
         *   The floor still bites in the direction that matters — a sweep that
         *   stopped finding files, or a checkout deleted without its route
         *   being reconsidered, fails.
         */
        expect(checkoutFiles().length).toBeGreaterThanOrEqual(11);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#727 — and the amount the one attacker-controlled checkout sends', () => {
    const CONTRIBUTE = 'src/app/api/cooperative/contribute/route.ts';

    it('IS ESTABLISHED AS A NUMBER BEFORE IT IS COMPARED', () => {
        /*
         *   THE hole the bypass left open. `if (!amount || amount < 1000)` asks
         *   two questions about a value straight out of a JSON body:
         *
         *       "abc"   !amount false, "abc" < 1000 false   → passes
         *       1e308   !amount false, 1e308 < 1000 false   → passes
         *
         *   and Math.round(amount * 100) then yields NaN or Infinity, both of
         *   which JSON.stringify writes as `"amount": null`. That is the exact
         *   body shape #706's guard exists to refuse, and this route does not
         *   go through the function carrying it.
         */
        const src = code(CONTRIBUTE);

        expect(src).toContain("typeof amount !== 'number'");
        expect(src).toContain('!Number.isFinite(amount)');

        //   THE ORDERING. A minimum check in front of the type check would
        //   still let "abc" through on the question that decides.
        const typeAt = src.indexOf("typeof amount !== 'number'");
        const minAt = src.indexOf('amount < 1000');
        expect(typeAt).toBeGreaterThan(-1);
        expect(minAt).toBeGreaterThan(typeAt);
    });

    it('AND THE GUARD IS ON THE KOBO FIGURE, BECAUSE THAT IS WHERE THE OVERFLOW IS', () => {
        /*
         *   THE correction, and it was this test that found it. The first
         *   version of the fix checked only the naira value:
         *
         *       typeof amount === 'number' && Number.isFinite(amount)
         *
         *   1e308 satisfies both and is greater than 1000, so it passed — and
         *   `1e308 * 100` is Infinity, which is written into the request body
         *   as `"amount": null`. Exactly the shape the guard was added to stop,
         *   surviving the guard.
         *
         *   The conversion is where it overflows, so the conversion is what is
         *   checked. #706 applies the same predicate to the nine checkouts that
         *   use the shared initializer.
         */
        const accepts = (amount: unknown) => {
            if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
            if (amount < 1000) return false;
            const kobo = Math.round(amount * 100);
            return Number.isSafeInteger(kobo) && kobo >= 1;
        };

        //   What used to get through, and what it became in the request body.
        for (const bad of ['abc', '5000', 1e308, Number.POSITIVE_INFINITY, NaN, null, true, []]) {
            expect(accepts(bad)).toBe(false);
        }

        //   And an ordinary contribution is still accepted — the guard has to
        //   refuse the right things, not everything.
        expect(accepts(1000)).toBe(true);
        expect(accepts(25_000.5)).toBe(true);
        expect(accepts(999)).toBe(false);
    });

    it('AND THE ROUTE SENDS THE FIGURE IT CHECKED, NOT A SECOND CONVERSION', () => {
        /*
         *   A guard on a value the request body does not carry guards nothing.
         *   This was `amount: Math.round(amount * 100)` inline at the fetch —
         *   a second conversion, which a guard above it could only ever check
         *   by coincidence.
         */
        const src = code(CONTRIBUTE);

        expect(src).toContain('const amountKobo = Math.round(amount * 100)');
        expect(src).toContain('Number.isSafeInteger(amountKobo)');
        expect(src).toContain('amount: amountKobo,');

        //   And the conversion happens exactly once in the file.
        expect(src.split('Math.round(amount * 100)').length - 1).toBe(1);

        //   Checked before it is sent.
        expect(src.indexOf('amount: amountKobo,'))
            .toBeGreaterThan(src.indexOf('Number.isSafeInteger(amountKobo)'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#727 — one verifyPaystackPayment, and it is the one that fails closed', () => {
    it('THERE IS EXACTLY ONE DEFINITION IN THE APPLICATION', () => {
        //   THE assertion. Two functions of this name, one hardened and one
        //   not, is a trap whichever one happens to be imported today.
        const definers = sourceFiles().filter((rel) =>
            /\b(export\s+)?async\s+function\s+verifyPaystackPayment\b/.test(code(rel)));

        expect(definers).toEqual(['src/lib/paystack-server.ts']);
    });

    it('AND THE CLIENT MODULE NO LONGER READS THE PAYSTACK SECRET', () => {
        /*
         *   lib/paystack.ts is "use client". A non-NEXT_PUBLIC variable is
         *   undefined in a browser bundle, so the removed function would have
         *   sent `Bearer undefined` had a client component ever called it —
         *   and the failure would have come back as an ordinary
         *   `{ success: false }`, indistinguishable from a declined payment.
         */
        const src = code('src/lib/paystack.ts');

        expect(src).toContain('"use client"');
        expect(src).not.toContain('PAYSTACK_SECRET_KEY');
        expect(src).not.toContain('/transaction/verify');
    });

    it('AND THE SURVIVING ONE STILL FAILS CLOSED ON A MISSING SECRET', () => {
        /*
         *   Vacuity guard on "the one that fails closed". Pinning the count at
         *   one is worth nothing if the survivor is the weak implementation —
         *   removing the wrong copy would satisfy every assertion above.
         *
         *   SCOPED TO THE VERIFY FUNCTION, NOT THE FILE, and this assertion is
         *   why that matters. Written as `toContain` over the whole source it
         *   SURVIVED a mutant that deleted the throw from verifyPaystackPayment
         *   — because initializePaystackPayment, in the same file, carries the
         *   identical line, so the claim held against a verify path that had
         *   stopped failing closed.
         *
         *   SIXTH TIME IN THIS AUDIT a file-level match has passed a use-level
         *   claim (#719, #723, #724, #725, #726). The rule this keeps proving:
         *   an assertion about what a FUNCTION does must be scoped to that
         *   function's own body.
         */
        const src = code('src/lib/paystack-server.ts');
        const at = src.indexOf('export async function verifyPaystackPayment(');
        expect(at).toBeGreaterThan(-1);

        //   To the end of that function: the next top-level declaration.
        const after = src.slice(at + 1);
        const next = after.search(/\nexport (async )?function |\nexport const /);
        const body = next > 0 ? after.slice(0, next) : after;

        expect(body).toContain('if (!secretKey) throw new Error("Payment service not configured")');
        //   And it hands back Paystack's answer rather than a boolean of its
        //   own, so a caller cannot read "did not verify" as "not successful".
        expect(body).toContain('const data: PaystackVerifyResponse = await response.json()');

        //   Vacuity guard on the slice: a body that ran to the end of the file
        //   would make the scoping above decorative.
        expect(body.length).toBeLessThan(src.length);
        expect(body).not.toContain('export async function initializePaystackPayment');
    });

    it('AND THE ONE THING STILL IMPORTED FROM THE CLIENT MODULE IS THE HARMLESS ONE', () => {
        //   Vacuity guard in the other direction: if something had been
        //   importing the removed function, this file would be describing a
        //   deletion that broke a caller.
        const importers = sourceFiles()
            .filter((rel) => /from\s+["']@\/lib\/paystack["']/.test(code(rel)));

        expect(importers).toEqual(['src/app/api/cooperatives/register/route.ts']);
        expect(code(importers[0])).toContain('import { generateReference } from "@/lib/paystack"');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   rather than by checkout, each mutant proving its edit landed by a unique
 *   string on disk before the suite is run.
 *
 *   THE FIRST THREE ARE THE FINDING ITSELF, run against #695's suite rather
 *   than this one: each points a raw-fetch checkout at a type no processor
 *   owns. Before the repair all three SURVIVED — that is what this finding is.
 *
 *     MUTANT                                            AGAINST      RESULT
 *     contribute mints a type nothing routes            #695    SURVIVED→KILLED
 *     wallet mints a type nothing routes                #695    SURVIVED→KILLED
 *     coop register mints a type nothing routes         #695    SURVIVED→KILLED
 *     the sweep skips api/ and sees only the actions    both         KILLED
 *     the sweep stops matching the raw endpoint         both         KILLED
 *     the contribute type guard is dropped              own          KILLED
 *     the guard admits an overflowing kobo figure       own          KILLED
 *     the route sends a second, unchecked conversion    own          KILLED
 *     the weak verifyPaystackPayment is restored        own          KILLED
 *     the HARDENED one is removed instead of the weak   own          KILLED
 *     the survivor stops failing closed on no secret    own    SURVIVED→KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this suite header                          own       SURVIVED ✓
 *
 * ── THE TWO THINGS THIS RUN CAUGHT IN THE REPAIR ITSELF ─────────────────────
 *
 *   ONE. THE SWEEP WAS WRITTEN TWICE. The first draft defined it here and left
 *   a copy in #695's suite. Breaking either copy left the other suite green,
 *   which is this audit's most frequent defect — two copies of one fact —
 *   reproduced inside the repair for it. Extracted to
 *   lib/testing/paystack-checkout-scan; both suites now import it, so the two
 *   sweep mutants above kill BOTH.
 *
 *   TWO. THE FAIL-CLOSED ASSERTION WAS FILE-LEVEL. Written as `toContain` over
 *   the whole of paystack-server.ts, it survived a mutant that deleted the
 *   throw from verifyPaystackPayment — because initializePaystackPayment, in
 *   the same file, carries the identical line. The claim held against a verify
 *   path that had stopped failing closed.
 *
 *   THAT IS THE SIXTH TIME IN THIS AUDIT (#719, #723, #724, #725, #726) that a
 *   file-level match has passed a use-level claim. The rule, restated because
 *   it keeps costing: an assertion about what a FUNCTION does must be scoped to
 *   that function's body — never to a file that may legitimately contain the
 *   same line somewhere else.
 *
 *   A third thing is worth recording because it was caught by a TEST rather
 *   than a mutant: the first version of the contribute guard checked only
 *   `Number.isFinite(amount)`, and 1e308 satisfies it while `1e308 * 100`
 *   overflows to Infinity. The guard moved onto the kobo figure — the value
 *   actually sent — which is what #706 says in the first place.
 */
