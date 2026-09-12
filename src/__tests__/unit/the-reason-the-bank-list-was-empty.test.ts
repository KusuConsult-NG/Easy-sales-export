/**
 * @jest-environment node
 */

/**
 *   #667 THE MEMBER WAS OFFERED A RETRY BUTTON AND NOT TOLD WHY.
 *
 *   The last of the four Paystack paths the captured server log named:
 *
 *       [ERROR] getBankList error: {"error":"Paystack API error: 403"}
 *
 *   `getBankList` is careful about its refusals. It returns a DIFFERENT message
 *   for each way it can fail:
 *
 *       "Authentication required"        the session expired
 *       "Payment service not configured" PAYSTACK_SECRET_KEY is unset
 *       "Paystack API error: 403"        the upstream refused
 *       "Failed to fetch bank list"      Paystack answered with status:false
 *
 *   THERE ARE TWO COPIES OF THE SCREEN THAT CALLS IT, and they do not agree
 *   about what to do with that:
 *
 *     components/onboarding/   renders the message in an alert, with a retry.
 *                              Used by export onboarding.
 *     components/shared/       sets `banksError`, branches on it, and renders a
 *                              bare "Retry loading banks" link. THE TEXT IS
 *                              NEVER SHOWN. Used by marketplace onboarding and
 *                              by /profile/bank-account.
 *
 *   `/profile/bank-account` is where a member sets the account their money is
 *   paid into — so the copy that throws the reason away is the one on the
 *   screen that matters most.
 *
 * ── WHY A BARE RETRY IS WORSE THAN NO RETRY ─────────────────────────────────
 *
 *   Two of those four failures CANNOT BE FIXED BY RETRYING. A member whose
 *   session has expired needs to sign in again; a deployment with no Paystack
 *   key needs an operator. Both are shown a red "Retry loading banks" link,
 *   press it, watch nothing happen, and have no way to learn which of the two
 *   they are in.
 *
 *   The information existed, was computed deliberately, crossed the boundary
 *   into the component, and was dropped at the last step. "Could not tell"
 *   rendered as a button — the class #620 and #621 are filed under, and the
 *   same shape as #665's unread flag one screen over.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

const SHARED = 'src/components/shared/BankAccountVerification.tsx';
const ONBOARDING = 'src/components/onboarding/BankAccountVerification.tsx';
const ACTION = 'src/app/actions/paystack.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#667 — the action still distinguishes its refusals', () => {
    it('IT RETURNS A DIFFERENT MESSAGE FOR EACH WAY IT CAN FAIL', () => {
        /*
         *   The positive control for everything below. "The screen shows the
         *   message" is worth nothing if the action collapses four failures
         *   into one string — and a careless fix to this finding might have
         *   done that instead of rendering what was already there.
         */
        //   SCOPED TO getBankList's OWN BODY. The first version read the whole
        //   file and a mutant that collapsed two of its refusals into one
        //   SURVIVED — `verifyBankAccount`, further down the same file, returns
        //   "Payment service not configured" too, so the string was still
        //   there. A check on the presence of a message is not a check on which
        //   function says it.
        const action = code(ACTION);
        const start = action.indexOf('export async function getBankList');
        const body = action.slice(start, action.indexOf('export async function', start + 10));

        expect(body).toContain('Authentication required');
        expect(body).toContain('Payment service not configured');
        expect(body).toContain('Failed to fetch bank list');
        //   And the upstream status, which is how a 403 was distinguishable
        //   from a 500 in the log that produced this finding.
        expect(body).toContain('`Paystack API error: ${response.status}`');

        //   Four distinct strings, not four mentions of two.
        expect(new Set([
            'Authentication required',
            'Payment service not configured',
            'Failed to fetch bank list',
        ].filter((m) => body.includes(m))).size).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#667 — and both screens now say which one happened', () => {
    it.each([
        ['the shared screen — /profile/bank-account and marketplace', SHARED],
        ['the export onboarding screen', ONBOARDING],
    ])('%s RENDERS THE MESSAGE, NOT JUST A BUTTON', (_name, file) => {
        /*
         *   THE defect, in the first of the two. `{banksError && (<button …>)}`
         *   branched on the message and rendered none of it.
         *
         *   Anchored on the message being INTERPOLATED, not on the identifier
         *   appearing — the identifier appeared in the broken version too,
         *   which is exactly how this survived.
         */
        expect(code(file)).toContain('{banksError}');
    });

    it('AND BOTH STILL OFFER THE RETRY', () => {
        //   The other half. Showing the reason is also satisfied by removing
        //   the button, and for the two failures that ARE transient — a 403, a
        //   dropped connection — pressing it is the whole remedy.
        for (const file of [SHARED, ONBOARDING]) {
            expect(`${file}: ${/onClick=\{load(Banks|BankList)\}/.test(code(file))}`).toBe(`${file}: true`);
        }
    });

    it('AND NEITHER LETS THE MEMBER PAST AN EMPTY LIST', () => {
        /*
         *   A member who cannot see their bank must not be able to submit an
         *   account without one — the account this screen collects is where
         *   their money is sent. Both gate the verify on a chosen bank.
         */
        for (const file of [SHARED, ONBOARDING]) {
            expect(`${file}: ${/if \(!bankName/.test(code(file))}`).toBe(`${file}: true`);
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the shared screen drops the message again           KILLED
 *     the onboarding screen drops it                                  KILLED
 *     the retry button is removed instead of explained                KILLED
 *     the action collapses its four refusals into one string          KILLED
 *       — survived the first run: the whole FILE was read, and
 *         verifyBankAccount says "Payment service not configured" too.
 *         Scoped to getBankList's own body.
 *     the verify stops requiring a chosen bank                        KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT IS RECORDED AND NOT FIXED ──────────────────────────────────────────
 *
 *   THERE ARE STILL TWO COPIES OF THIS SCREEN. They differ in more than this —
 *   field validation, the BVN panel, what they emit upward — and merging them
 *   is a change to the form a member types their payout account into, with a
 *   blast radius this finding does not need. What is fixed is the divergence
 *   that cost the member an answer; the duplication is named here so the next
 *   person does not find it by surprise, and this file asserts the two together
 *   so a fix applied to one of them fails until it reaches both.
 */
