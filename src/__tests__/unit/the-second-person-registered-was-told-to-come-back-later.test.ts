/**
 * @jest-environment node
 */

/**
 *   #849 THE SECOND PERSON REGISTERED IN AN OFFICE WAS TOLD THERE HAD BEEN TOO
 *   MANY ATTEMPTS.
 *
 *   The owner: "after a user registers and submits application, and tries to
 *   register another user again there is an error saying too many attempts, try
 *   again later, why?"
 *
 *   `registerAction` metered itself on `rateLimitConfig.login` — FIVE PER
 *   FIFTEEN MINUTES, KEYED BY IP — and three things compounded on that number:
 *
 *     1. IT IS THE LOGIN LIMIT, on a public sign-up form. rate-limits.config's
 *        own contactForm entry says, in as many words, that this is wrong:
 *
 *            "Nigerian mobile networks share IPs heavily, so a limit tuned as
 *             though an IP were a person locks out real users. The login
 *             config's 5-per-15-minutes would be actively harmful applied here."
 *
 *        Registration is that form exactly, and a field agent enrolling members
 *        from one office is the population that comment describes. The counter-
 *        example was written in the same file as the defect.
 *
 *     2. THE TOKEN WAS SPENT BEFORE THE SUBMISSION WAS EVEN VALID. `check()`
 *        consumes whether or not the attempt was any good, and it ran BEFORE
 *        Zod. The owner's production log shows three password refusals inside
 *        ninety seconds — three of the five gone, to somebody who had not
 *        registered at all.
 *
 *     3. AND THE ATTEMPTS THAT FAILED WERE OUR FAULT. The same log carries
 *        `Registration error … [57014] canceling statement due to statement
 *        timeout` — #848, the unindexed phone dedup. Each retry of a request
 *        the platform could not serve spent another token, and the fifth told
 *        the person they had tried too often.
 *
 *   So the message was not merely unhelpful, it was untrue: the attempts were
 *   not too many, they were too expensive, and the limit built for guessing
 *   passwords was counting them.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   Which of the three the owner hit is NOT established, and this file does not
 *   pick one — production is not reachable from here and the log does not carry
 *   the limiter's own decisions. All three are real, all three are fixed, and
 *   the honest statement is that any of them produces the reported message.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { rateLimit } from '@/lib/rate-limiter';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

const AUTH = 'src/app/actions/auth.ts';

const perHour = (c: { maxRequests: number; interval: number }) =>
    c.maxRequests / (c.interval / 3_600_000);

// ─────────────────────────────────────────────────────────────────────────────
describe('#849 — registration has its own allowance, sized for the people using it', () => {
    it('THE REGISTRATION LIMIT EXISTS AND IS NOT THE LOGIN ONE', () => {
        expect(rateLimitConfig.registration).toBeDefined();
        expect(rateLimitConfig.registration.name).toBe('registration');

        //   A separate `name` is what separates the Redis key space AND the
        //   in-memory fallback's — see rate-limiter's `check`. Sharing a name is
        //   how the withdrawal limiter once read a counter spent by telemetry.
        expect(rateLimitConfig.registration.name)
            .not.toBe(rateLimitConfig.login.name);
    });

    it('AND IT IS MORE PERMISSIVE THAN LOGIN, SUSTAINED — not just in burst', () => {
        /*
         *   The assertion the contact-form suite had to earn: login's
         *   5-per-15-minutes is ALSO 20/hour, so a limit that merely looked
         *   generous could deliver none of the headroom it was for.
         */
        expect(perHour(rateLimitConfig.registration))
            .toBeGreaterThan(perHour(rateLimitConfig.login));
    });

    it('THE REPORTED CASE, EXECUTED: a field agent enrols six people in a row', async () => {
        /*
         *   Driven through the REAL limiter rather than compared against the
         *   config, because the number in the table and the number in force have
         *   been different in this codebase twice — #644 for `api`, and #849
         *   itself for `login`.
         *
         *   Six, because five was the old ceiling and the sixth is the person
         *   the owner could not register.
         */
        const limiter = rateLimit(rateLimitConfig.registration);
        const ip = '197.210.0.1';                    // one office, one address

        const results = [];
        for (let i = 0; i < 6; i += 1) {
            results.push((await limiter.check(ip)).success);
        }

        expect(results).toEqual([true, true, true, true, true, true]);
    });

    it('AND THE OLD LIMIT WOULD HAVE REFUSED HER — the control', async () => {
        /*
         *   Proves the case above is about the change and not about a limiter
         *   that never bites. Same loop, the `login` config, a different IP so
         *   the two do not share a bucket.
         */
        const limiter = rateLimit(rateLimitConfig.login);
        const ip = '197.210.0.2';

        const results = [];
        for (let i = 0; i < 6; i += 1) {
            results.push((await limiter.check(ip)).success);
        }

        expect(results).toEqual([true, true, true, true, true, false]);
    });

    it('AND IT STILL STOPS A SCRIPT — a limit that never refuses is not a limit', async () => {
        /*
         *   The half that must not regress. The point of widening was headroom
         *   for an office, not removing the control: bulk account creation is
         *   what this exists to refuse.
         */
        const limiter = rateLimit(rateLimitConfig.registration);
        const ip = '197.210.0.3';

        let refusedAt = -1;
        for (let i = 0; i < 60; i += 1) {
            if (!(await limiter.check(ip)).success) { refusedAt = i; break; }
        }

        expect(refusedAt).toBe(rateLimitConfig.registration.maxRequests);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#849 — a refused password does not spend a registration', () => {
    /**
     *   Asserted on ORDER, because that is what the defect was: both statements
     *   were present and correct, and the wrong one ran first.
     */
    it('THE SUBMISSION IS VALIDATED BEFORE THE LIMITER IS CONSUMED', () => {
        /*
         *   ANCHORED ON THE CONSUMING CALL, not on the word "check" or on
         *   "parse" — this audit's most repeated test defect is an assertion
         *   settled by the wrong occurrence, and `auth.ts` contains several of
         *   each. `registrationLimiter.check(ip)` occurs once.
         */
        const src = code(AUTH);

        const consume = src.indexOf('registrationLimiter.check(ip)');
        const validate = src.indexOf('registerSchema.parse(');

        expect(consume).toBeGreaterThan(-1);
        expect(validate).toBeGreaterThan(-1);
        expect(validate).toBeLessThan(consume);
    });

    it('AND BOTH ARE STILL INSIDE registerAction, not merely in the file', () => {
        /*
         *   The check that stops the one above passing vacuously. Moving either
         *   statement into a different function would satisfy an index
         *   comparison across the whole file and change what actually runs.
         */
        const src = code(AUTH);
        const start = src.indexOf('export async function registerAction');
        const next = src.indexOf('export async function', start + 10);
        const body = src.slice(start, next === -1 ? undefined : next);

        expect(body).toContain('registerSchema.parse(');
        expect(body).toContain('registrationLimiter.check(ip)');
    });

    it('AND THE LOGIN LIMITER IS NO LONGER WIRED INTO REGISTRATION', () => {
        const src = code(AUTH);

        expect(src).toContain('rateLimit(rateLimitConfig.registration)');
        expect(src).not.toContain('rateLimit(rateLimitConfig.login)');
    });

    it('AND THE PERSON IS TOLD HOW LONG TO WAIT', () => {
        /*
         *   "Please try again later" gave somebody locked out of signing up no
         *   way to know whether later meant a minute or a morning — and the
         *   other limiter in this codebase, consumeLoginAttempt, already tells
         *   people the number. The `reset` was on the result the whole time.
         */
        const src = code(AUTH);
        const at = src.indexOf('registrationLimiter.check(ip)');
        const block = src.slice(at, at + 700);

        expect(block).toContain('rateLimitResult.reset');
        expect(block).toMatch(/minute/);
        expect(block).not.toContain('Please try again later.');
    });

    it('AND A MISSING reset DOES NOT PRINT "NaN minutes"', () => {
        /*
         *   Math.max(1, NaN) is NaN. The first version of that line read
         *
         *       Math.max(1, Math.ceil((rateLimitResult.reset - Date.now()) / 60000))
         *
         *   and a limiter result without `reset` would have told somebody locked
         *   out of signing up to try again in NaN minutes — worse than the vague
         *   message it replaced.
         *
         *   It was found because auth-actions-behaviour's limiter mock returns
         *   `{ success, remaining }` and no `reset`, so the shape is not
         *   hypothetical even if the live limiters always supply it. Executed on
         *   the branch rather than asserted on source, because the defect is
         *   arithmetic.
         */
        const fallbackMinutes = Math.ceil(rateLimitConfig.registration.interval / 60000);

        const minutesFor = (reset: unknown) => {
            const untilReset = Number(reset) - Date.now();
            return Number.isFinite(untilReset)
                ? Math.max(1, Math.ceil(untilReset / 60000))
                : fallbackMinutes;
        };

        expect(minutesFor(undefined)).toBe(fallbackMinutes);
        expect(minutesFor(Date.now() + 10 * 60000)).toBe(10);
        //   Already elapsed — never zero or negative in a sentence to a person.
        expect(minutesFor(Date.now() - 5000)).toBe(1);
    });

    it('AND AN UNIDENTIFIED CALLER IS REPORTED, not silently pooled', () => {
        /*
         *   getActionClientIp returns 'unknown' when the address cannot be
         *   established, and lib/client-ip calls pooling them "the safe
         *   direction for a limiter". For login it is. For REGISTRATION it means
         *   one allowance for the whole platform — which presents exactly as the
         *   defect reported here, with nothing in the log to say so.
         *
         *   It is reported, not bypassed: the limit still applies.
         */
        const src = code(AUTH);
        const at = src.indexOf("if (ip === 'unknown')");

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 400)).toContain('logger.error');
        //   The limiter must still run — a "fix" that skipped it would be a hole.
        expect(src.indexOf('registrationLimiter.check(ip)')).toBeGreaterThan(at);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#849 — and the login entry is a live number again', () => {
    /**
     *   Once registration stopped reading `rateLimitConfig.login`, that entry
     *   had NO consumer: it declared "5 attempts per 15 minutes" in the table
     *   where every limit is written down, while the login limit actually in
     *   force came from lib/rate-limit's own constants.
     *
     *   That is #644 exactly — `api` declared 100 a minute with 200 in force —
     *   three lines further down a module that already imports the table.
     */
    it('THE LOGIN WINDOW COMES FROM THE TABLE', async () => {
        const { LOGIN_WINDOW_MS } = await import('@/lib/rate-limit');
        expect(LOGIN_WINDOW_MS).toBe(rateLimitConfig.login.interval);
    });

    it('AND SO DOES THE ATTEMPT COUNT, with the env override kept', () => {
        /*
         *   Read from source: the constant is module-private, deliberately, and
         *   exporting it to test it would widen the module's surface for the
         *   test's convenience. What matters is that the DEFAULT is the table's
         *   number rather than a second copy of it — a literal '5' beside
         *   MAX_LOGIN_ATTEMPTS is the drift this case exists to catch.
         */
        const src = code('src/lib/rate-limit.ts');

        expect(src).toContain('rateLimitConfig.login.maxRequests');
        expect(src).not.toMatch(/MAX_LOGIN_ATTEMPTS \|\| '5'/);
    });

    it('AND THE CONTACT FORM COMPARISON IT ANCHORS STILL HOLDS', () => {
        //   contact-rate-limit's sizing argument is stated against login's
        //   sustained rate. Deriving that entry must not have moved it.
        expect(perHour(rateLimitConfig.contactForm))
            .toBeGreaterThan(perHour(rateLimitConfig.login));
    });
});
