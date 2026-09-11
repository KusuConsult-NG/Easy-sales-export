/**
 * @jest-environment node
 */

/**
 *   #642 THE ENUMERATION CONTROL REACHED ONE OF THE TWO DOORS.
 *
 *   #641 asked which rate limits guard nothing. Three buckets in
 *   `rate-limits.config.ts` had no consumer at all — `api`, `webhook` and `kyc`
 *   — and following the third one led here.
 *
 *   Resolving a bank account turns any ten-digit NUBAN into the account
 *   holder's REAL NAME through the platform's Paystack key. #243 wrote down
 *   what that is — "a name-lookup oracle for whoever is signed in" — and sized
 *   `bankVerification` as the control, because ownership cannot be checked
 *   before resolving: verifying your own account IS the feature.
 *
 *       ten an hour absorbs mistyped digits and a wrong bank picked twice,
 *       and is useless for enumeration
 *
 *   It was applied to `actions/paystack.ts::verifyBankAccount`, and
 *   `/api/kyc/verify-bank-account` — which asks Paystack's `/bank/resolve` for
 *   the same answer, reachable by the same signed-in caller — carried only
 *   `withRateLimit`, the generic wrapper in lib/rate-limit.ts, defaulting to
 *   TWO HUNDRED A MINUTE.
 *
 *   (I first wrote that the two doors shared `resolveBankAccount`. They do not:
 *   the route uses that helper and the action still writes its own fetch, so
 *   #346's consolidation reached one of two call sites. Corrected here and
 *   asserted below, because the comparison only means something if both doors
 *   really do reach the same Paystack endpoint.)
 *
 *   Twelve thousand an hour against a control sized at ten. A meter on one door
 *   and a turnstile on the other, for one operation.
 *
 * ── AND TWO COUNTERS WOULD HAVE BEEN THE SAME DEFECT ────────────────────────
 *
 *   `rateLimit()` constructs its own counter, so building the bucket twice —
 *   once in the action, once in the route — is ten through one door AND ten
 *   through the other. #641 found that shape and this repair does not
 *   reintroduce it: one instance in lib/bank-verify-rate-limit, imported by
 *   both.
 *
 * ── THE `kyc` BUCKET IS LEFT UNWIRED, ON PURPOSE, AND PINNED ────────────────
 *
 *   Three per hour, "very strict (cost optimization)", consumed by nothing —
 *   and the `aiChat` entry beside it reads "Same reasoning as the `kyc` entry
 *   above, which is throttled for cost rather than for security", so its author
 *   believed it was wired.
 *
 *   Wiring it today would be a control with no benefit and a real cost.
 *   `IDENTITY_PROVIDER` is the constant `'none'`: verify-bvn and verify-nin
 *   perform no external lookup, verify-business answers 503, verify-id is
 *   retired behind a 410. There is no per-call charge to throttle, and three an
 *   hour applied to a FORMAT CHECK would refuse a member who mistyped their BVN
 *   twice.
 *
 *   So the rule is asserted CONDITIONALLY: the moment IDENTITY_PROVIDER stops
 *   being 'none', the bucket must have a consumer. That is the difference
 *   between a rule nobody wired and a rule waiting for the thing it governs —
 *   and it is the difference #629 was about.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { IDENTITY_PROVIDER } from '@/lib/identity-verification';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.d\.ts$/.test(full)) out.push(full);
    }
    return out;
}

const APP_FILES = walk(join(ROOT, 'src'))
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.includes('__tests__') && !f.includes('/testing/'));

const ROUTE = 'src/app/api/kyc/verify-bank-account/route.ts';
const ACTION = 'src/app/actions/paystack.ts';
const LIMITER = 'src/lib/bank-verify-rate-limit.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#642 — both doors onto the oracle have the same meter', () => {
    it('THE ROUTE ASKS THE BANK-VERIFICATION BUCKET', () => {
        const route = code(ROUTE);
        expect(route).toContain('bankVerifyLimiter.check(session.user.id)');
        //   And acts on the answer. A check whose result is discarded is #331's
        //   shape, and this file would otherwise be satisfied by one.
        expect(route).toContain('if (!rl.success)');
        expect(route).toContain('status: 429');
    });

    it('AND SO DOES THE ACTION — the door that always did', () => {
        const action = code(ACTION);
        expect(action).toContain('bankVerifyLimiter.check(sessionUserId)');
        expect(action).toContain('if (!rl.success)');
    });

    it('AND IT IS ONE COUNTER, NOT ONE EACH', () => {
        /*
         *   #641's lesson, not repeated. Two instances of the same config are
         *   two budgets, which is the defect wearing the shape of a fix.
         */
        const builders = APP_FILES.filter((f) =>
            /rateLimit\(rateLimitConfig\.bankVerification\)/.test(code(f)));
        expect(builders).toEqual([LIMITER]);

        for (const f of [ROUTE, ACTION]) {
            expect({ f, imports: code(f).includes('bank-verify-rate-limit') })
                .toEqual({ f, imports: true });
        }
    });

    it('AND NOTHING HAPPENS BEFORE IT BUT ESTABLISHING WHO YOU ARE', () => {
        /*
         *   A limiter after the resolve has not limited the oracle; it has paid
         *   for the lookup and then complained.
         *
         *   Stated as #641 states it, and for the same reason: "before the
         *   lookup" is satisfied by a check that has slid down past the body
         *   parse, and a mutant that did exactly that survived the first
         *   version. The meter goes immediately after the caller is known.
         */
        const route = code(ROUTE);
        const idAt = route.indexOf("const session = (await requireSession()).session;");
        //   Anchored on the whole statement, not on the call: the call's own
        //   `await` sits immediately before it and would otherwise be counted as
        //   work happening BEFORE the check.
        const checkAt = route.indexOf('const rl = await bankVerifyLimiter.check(session.user.id)');
        const lookupAt = route.indexOf('await resolveBankAccount(');
        expect({ id: idAt > -1, check: checkAt > -1, lookup: lookupAt > -1 })
            .toEqual({ id: true, check: true, lookup: true });
        expect(checkAt).toBeGreaterThan(idAt);
        expect(checkAt).toBeLessThan(lookupAt);

        //   The only await between the two is the session guard's own.
        const between = route.slice(
            idAt + 'const session = (await requireSession()).session;'.length, checkAt);
        expect({ awaitsBetween: (between.match(/\bawait\b/g) ?? []).length })
            .toEqual({ awaitsBetween: 0 });
    });

    it('AND THE GENERIC 200-A-MINUTE WRAPPER IS NO LONGER WHAT GUARDS IT', () => {
        /*
         *   Stated as an absence because the finding is the SIZE of the limit,
         *   not its presence. `withRateLimit` was there the whole time; it is
         *   `RATE_LIMIT_MAX_REQUESTS`, default 200 per minute, which is three
         *   orders of magnitude past a control written to be "useless for
         *   enumeration".
         */
        expect(code(ROUTE)).not.toContain('withRateLimit');
        expect(rateLimitConfig.bankVerification.maxRequests).toBe(10);
        expect(rateLimitConfig.bankVerification.interval).toBe(60 * 60 * 1000);
    });

    it('AND BOTH DOORS STILL ASK PAYSTACK THE SAME QUESTION', () => {
        //   The other half: "the route is rate limited" is also satisfied by a
        //   route that no longer does anything.
        expect(code(ROUTE)).toContain('resolveBankAccount(accountNumber, bankCode)');
        //   The action reaches the same Paystack endpoint by its own fetch —
        //   which is what makes one meter the right answer for both.
        expect(code(ACTION)).toContain('/bank/resolve?account_number=');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#642 — the kyc bucket waits for the thing it governs', () => {
    const consumers = APP_FILES.filter((f) => /rateLimitConfig\.kyc\b/.test(code(f)));

    it('IT HAS NO CONSUMER WHILE THERE IS NO IDENTITY PROVIDER', () => {
        //   Recorded as the measurement it is, so "nothing uses it" is a fact
        //   somebody decided rather than one nobody noticed.
        expect(IDENTITY_PROVIDER).toBe('none');
        expect(consumers).toEqual([]);
    });

    it('AND THE MOMENT ONE RETURNS, IT MUST HAVE ONE', () => {
        /*
         *   The conditional. This assertion is vacuous today BY CONSTRUCTION and
         *   says so — which is the only honest way to pin a rule whose subject
         *   does not exist yet. When IDENTITY_PROVIDER stops being 'none', the
         *   lookups start costing money and this fails until the bucket written
         *   for them is wired.
         */
        if (IDENTITY_PROVIDER !== 'none') {
            expect(consumers.length).toBeGreaterThan(0);
        } else {
            //   The premise of the exemption, asserted rather than assumed: the
            //   four KYC endpoints perform no external lookup today.
            expect(code('src/app/api/kyc/verify-id/route.ts')).toContain('status: 410');
            expect(code('src/app/api/kyc/verify-business/route.ts')).toContain('status: 503');
            for (const kind of ['bvn', 'nin']) {
                const src = code(`src/app/api/kyc/verify-${kind}/route.ts`);
                expect({ kind, callsAProvider: /fetch\(|axios|qoreid/i.test(src) })
                    .toEqual({ kind, callsAProvider: false });
            }
        }
    });

    it('AND THE BUCKET IS STILL DECLARED, so re-wiring is one line', () => {
        //   Deleting it would make the return of a provider a design decision
        //   again rather than a wiring job. #629's class: an unused RULE is
        //   different from an unused helper.
        expect(rateLimitConfig.kyc.maxRequests).toBe(3);
        expect(rateLimitConfig.kyc.interval).toBe(60 * 60 * 1000);
        expect(rateLimitConfig.kyc.name).toBe('kyc');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the route goes back to the generic wrapper          KILLED
 *     the route asks the limit and ignores the answer                 KILLED
 *     the check moves below everything it meters                      KILLED
 *     the action builds its own counter again                         KILLED
 *     the bank-verification budget is widened                         KILLED
 *     the route stops resolving anything at all                       KILLED
 *     the kyc bucket is widened where it sits                         KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   "The route stops resolving anything at all" is the guard against the cheap
 *   way to pass this file: a metered door that has stopped doing the thing is
 *   not a fixed door.
 *
 * ── AND THE POSITION MUTANT SURVIVED FIRST, AGAIN ───────────────────────────
 *
 *   "The check moves below everything it meters" survived the first run, for
 *   exactly the reason it survived in #641: the property was "before the
 *   lookup", and a check that has slid down past the body parse is still before
 *   the lookup. Same repair, same wording — nothing happens between establishing
 *   who the caller is and asking whether they may.
 *
 *   One wrinkle worth keeping: the first sharpened version counted ONE `await`
 *   between the session and the check, and failed. The `await` it found was the
 *   check's own. Anchoring on the statement rather than on the call fixed it —
 *   a position test has to know where the thing it is measuring begins.
 */
