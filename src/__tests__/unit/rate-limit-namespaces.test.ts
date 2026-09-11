/**
 * @jest-environment node
 */

/**
 * Eight rate limits shared one counter, so using the app refused a withdrawal.
 *
 * lib/rate-limiter.ts's rateLimit(config) built every limiter with the same
 * fixed Upstash prefix —
 *
 *     prefix: "@upstash/ratelimit_custom"
 *
 * — and then called `limiter.limit(identifier)` with the caller's identifier and
 * nothing else. Eight distinct configs are passed to it across eighteen call
 * sites, and TWELVE of those sites key on `session.user.id`:
 *
 *   payment      10/min    six paths: marketplace verify, cooperative payment,
 *                          farm-nation, academy, cooperative verify-payment,
 *                          cooperative contribute
 *   withdrawal    5/min    cooperative/withdraw
 *   admin       100/min    approve-seller, broadcast/estimate, broadcast/send,
 *                          submit-verification
 *   telemetry   120/hour   hub/telemetry
 *   aiChat       30/10min
 *
 * So for one member, all of those limiters read and wrote a SINGLE Redis key
 * while applying five different windows and five different maximums to it.
 *
 * THE SHARP CONSEQUENCE
 * ---------------------
 * `withdrawal` is five per minute. Five requests of any of those kinds in a
 * minute — including hub/telemetry, which the platform emits as a matter of
 * course rather than because a person clicked anything — left the withdrawal
 * limiter reading a spent counter and refusing a member access to their own
 * money. Nothing in the message would say why. It runs the other way too: a
 * payment burst consumed the admin and contact budgets.
 *
 * THE FALLBACK COLLIDED THE SAME WAY
 * ----------------------------------
 * checkFallbackLimit is keyed on its `key` argument alone, and the limiter
 * passed the bare identifier. Namespacing only the Redis path would leave every
 * limit colliding again the moment Upstash was unreachable — which is exactly
 * when a member is least able to tell a rate limit from an outage.
 *
 * THE CONVENTION ALREADY EXISTED, AT ONE SITE OUT OF EIGHTEEN
 * ----------------------------------------------------------
 * password-reset calls `check(`password-reset:${email}`)`. Somebody knew. The
 * same shape as a guard applied on two doors out of three.
 *
 * WHY THE NAME COMES FROM THE OBJECT KEY
 * --------------------------------------
 * rateLimitConfig stamps each entry with its own key as `name`, so the name
 * cannot drift from what the limit is called and a new entry cannot be added
 * without one. Writing it out beside each config would be a second copy of a
 * string that already exists.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { rateLimitConfig } from '@/lib/rate-limits.config';

const ROOT = process.cwd();
const LIMITER = 'src/lib/rate-limiter.ts';
const CONFIG = 'src/lib/rate-limits.config.ts';

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

/** Every .ts/.tsx under a directory, tests excluded — #644 needs a sweep. */
function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'testing') continue;
            sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('every limit carries its own name', () => {
    it('and the name is the key it is stored under', () => {
        // THE property. Derived, so it cannot drift.
        for (const [key, limit] of Object.entries(rateLimitConfig)) {
            expect((limit as { name: string }).name).toBe(key);
        }
    });

    it('for every entry, with none forgotten', () => {
        const entries = Object.entries(rateLimitConfig);
        expect(entries.length).toBeGreaterThanOrEqual(8);
        expect(entries.every(([, l]) => typeof (l as { name?: unknown }).name === 'string')).toBe(true);
    });

    it('the limits themselves being unchanged', () => {
        // The fix must not quietly retune anything. Spot-checked on the two that
        // matter most to the finding.
        expect(rateLimitConfig.withdrawal).toMatchObject({ interval: 60_000, maxRequests: 5 });
        expect(rateLimitConfig.payment).toMatchObject({ interval: 60_000, maxRequests: 10 });
        expect(rateLimitConfig.telemetry).toMatchObject({ interval: 60 * 60 * 1000, maxRequests: 120 });
    });

    it('and derived from the key rather than written out twice', () => {
        const cfg = code(CONFIG);
        expect(cfg).toContain('Object.entries(LIMITS).map(([name, limit]) => [name, { ...limit, name }])');
        // A hand-written `name:` beside a limit is the drift this avoids.
        expect(cfg).not.toMatch(/^\s*name: ['"]/m);
    });
});

describe('the name separates the Redis key space', () => {
    const limiter = code(LIMITER);

    it('the prefix carries it — THE test', () => {
        expect(limiter).toContain('prefix: `@upstash/ratelimit_custom:${config.name}`');
    });

    it('and the single shared constant is gone', () => {
        expect(limiter).not.toContain('prefix: "@upstash/ratelimit_custom",');
    });

    it('so two limits with the same identifier do not meet', () => {
        // Exercised on the key shapes rather than against Redis.
        const prefixFor = (name: string) => `@upstash/ratelimit_custom:${name}`;
        const user = 'user-abc';

        expect(prefixFor('withdrawal') + ':' + user)
            .not.toBe(prefixFor('telemetry') + ':' + user);
    });

    it('and the old scheme genuinely collided, so this is not a no-op', () => {
        // Reconstructed. Without this the assertion above proves only that the
        // new keys differ, not that the old ones were the same.
        const old = (_name: string) => '@upstash/ratelimit_custom';
        expect(old('withdrawal') + ':user-abc').toBe(old('telemetry') + ':user-abc');
    });
});

describe('the in-memory fallback is separated too', () => {
    const limiter = code(LIMITER);

    it('by a key built from the name', () => {
        expect(limiter).toContain('const key = `${config.name}:${identifier}`;');
    });

    it('and every fallback call uses it, not the bare identifier', () => {
        // Counted: there are two fallback paths — no Upstash configured, and
        // Upstash erroring — and one of them keeping the bare identifier would
        // reopen the collision on exactly one branch.
        const namespaced = (limiter.match(/checkFallbackLimit\(key, config\.maxRequests, config\.interval\)/g) ?? []).length;
        expect(namespaced).toBe(2);
        expect(limiter).not.toContain('checkFallbackLimit(identifier,');
    });

    it('because the fallback is keyed on its argument alone', () => {
        // Vacuity guard: if checkFallbackLimit namespaced internally, none of
        // this would be needed.
        const fb = code('src/lib/rate-limiter-fallback.ts');
        expect(fb).toContain('key: string,');
        expect(fb).toContain('fallbackStore');
    });

    it('and that path is reached when Upstash is unreachable, which is when it matters', () => {
        // Asserted on CODE, not on the comment beside it — code() strips the
        // comment, which is how the first version of this assertion failed.
        expect(limiter).toContain('if (!isRedisConfigured) {');
        expect(limiter).toContain('} catch (error) {');
        expect(source(LIMITER)).toContain('Redis error - fall back to in-memory');
    });
});

describe('the premise: many configs, one identifier', () => {
    function walk(dir: string, out: string[] = []): string[] {
        for (const e of readdirSync(dir)) {
            const full = join(dir, e);
            if (statSync(full).isDirectory()) {
                if (e !== 'node_modules' && e !== '__tests__') walk(full, out);
            } else if (/\.tsx?$/.test(e)) out.push(full);
        }
        return out;
    }

    // All of src, not src/app: `login`'s limiter lives in an action outside the
    // route tree, and counting only routes undercounts the configs in play.
    const files = walk(join(ROOT, 'src'));

    it('at least eight different configs are passed to this limiter', () => {
        const used = new Set<string>();
        for (const f of files) {
            for (const m of readFileSync(f, 'utf-8').matchAll(/rateLimit\(rateLimitConfig\.([a-zA-Z]+)\)/g)) {
                used.add(m[1]);
            }
        }
        expect(used.size).toBeGreaterThanOrEqual(8);
        expect(used).toContain('withdrawal');
        expect(used).toContain('telemetry');
        expect(used).toContain('payment');
    });

    it('and many of them key on session.user.id, which is what made them meet', () => {
        // THE premise. Different configs with different identifiers would never
        // have collided.
        const sites: string[] = [];
        for (const f of files) {
            const text = readFileSync(f, 'utf-8');
            if (/\.check\(session\.user\.id\)/.test(text)) sites.push(f.slice(ROOT.length + 1));
        }
        expect(sites.length).toBeGreaterThanOrEqual(10);
        expect(sites).toContain('src/app/api/cooperative/withdraw/route.ts');
        expect(sites).toContain('src/app/api/hub/telemetry/route.ts');
    });

    it('the withdrawal limit being tight enough for that to bite', () => {
        // Five per minute is the number that turns a shared counter into a
        // member being refused their own money.
        expect(rateLimitConfig.withdrawal.maxRequests).toBeLessThanOrEqual(5);
    });

    it('and one site already namespaced, which is where the convention came from', () => {
        expect(code('src/app/actions/password-reset.ts'))
            .toContain('check(`password-reset:${email}`)');
    });
});

/*
 *   #643/#644 THE OTHER MODULE IS NO LONGER UNTOUCHED, AND THIS BLOCK RECORDED
 *   THE OPPOSITE DECISION.
 *
 *   It read: "its callers all share the platform-wide API budget on purpose, so
 *   there is nothing to separate. Named so the asymmetry reads as a decision."
 *
 *   THAT DECISION IS REVERSED, and the reason is the premise rather than the
 *   conclusion. "Nothing to separate" holds if the twelve callers are one
 *   operation. They are not:
 *
 *     MFA setup, enable, disable, status, verify
 *     QR verification
 *     the cooperative loan application
 *     BVN, NIN and business KYC submissions
 *     two admin password-reset endpoints, and the Paystack reconciliation
 *
 *   Those differ in cost and in the rate a real person legitimately reaches
 *   them, and the failure when they collide is the one this file's own header
 *   describes three paragraphs up: silent, and expressed as a refusal of
 *   something the member has not been doing. Enrolling in MFA could refuse a
 *   loan application.
 *
 *   Recording it as a reversal rather than quietly rewriting the assertions,
 *   because the earlier note was a decision somebody made and this file is
 *   where it was written down. #643 changed the key without noticing this block
 *   — it pinned the PREFIX and the config SHAPE, not the key, so it did not
 *   fail. That is itself worth keeping: an assertion that records a decision has
 *   to assert the thing the decision is about.
 */
describe('#643/#644 — the other limiter module now separates its callers too', () => {
    it('ITS PREFIX IS STILL ITS OWN', () => {
        //   The two modules keep distinct Upstash prefixes, which is what stops
        //   a scope here colliding with a named bucket there.
        const other = code('src/lib/rate-limit.ts');
        expect(other).toContain('prefix: "@upstash/ratelimit"');
        expect(other).not.toContain('ratelimit_custom');
    });

    it('AND THE KEY CARRIES A PER-ROUTE SCOPE — the decision this block reverses', () => {
        const other = code('src/lib/rate-limit.ts');
        expect(other).toContain('const key = `${scope}:${identity}`;');
        //   Required, so the pooling cannot come back by omission.
        expect(other).not.toMatch(/scope\?: string/);
    });

    it('AND THE VALUES COME FROM THAT TABLE, not a literal beside the import', () => {
        /*
         *   Added because a mutant survived: keeping the import and defining
         *   `const apiLimit = { maxRequests: 200, interval: 60000 }` beside it
         *   satisfied "imports the right module" completely. An import is not a
         *   use — #629's sentence, in the file that reversed a decision about
         *   where a number lives.
         */
        expect(code('src/lib/rate-limit.ts'))
            .toContain('const apiLimit = rateLimitConfig.api;');
    });

    it('AND NOTHING ELSE EXPORTS A `rateLimitConfig` TO BE CONFUSED WITH', () => {
        /*
         *   The collision itself, asserted as an absence. A mutant that put the
         *   second export back in lib/security.ts survived every other
         *   assertion here — nothing was checking that the NAME is unique, only
         *   that this one module imports the right one.
         */
        const owners = sourceFiles(join(process.cwd(), 'src'))
            .map((f) => f.replace(process.cwd() + '/', ''))
            .filter((f) => /export const rateLimitConfig\b/.test(code(f)));
        expect(owners).toEqual(['src/lib/rate-limits.config.ts']);
    });

    it('AND THE GENERIC TIER IS STILL TUNABLE WITHOUT A DEPLOY', () => {
        /*
         *   The capability that had to survive moving the number. lib/security's
         *   object read RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX_REQUESTS;
         *   replacing it with the hardcoded 100 the `api` bucket used to declare
         *   would have halved a live limit on twelve routes AND removed the
         *   knob. Both env vars are read, in the table, with the defaults that
         *   have been running.
         */
        const cfg = code('src/lib/rate-limits.config.ts');
        const apiBucket = cfg.slice(cfg.indexOf('    api: {'), cfg.indexOf('    webhook: {'));
        expect(apiBucket).toContain('process.env.RATE_LIMIT_WINDOW_MS');
        expect(apiBucket).toContain('process.env.RATE_LIMIT_MAX_REQUESTS');

        expect(rateLimitConfig.api.maxRequests)
            .toBe(parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200', 10));
        expect(rateLimitConfig.api.interval)
            .toBe(parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10));
    });

    it('AND IT READS THE ONE TABLE, not a second object under the same name', () => {
        /*
         *   #644. This asserted `rateLimitConfig.maxRequests`, which was the
         *   giveaway nobody read: every other importer of `rateLimitConfig` gets
         *   a table of named buckets, and that field does not exist on it. Two
         *   objects, one identifier, and the declaration a reader finds
         *   (`api: 100 a minute`) was not the limit in force (200).
         */
        const other = code('src/lib/rate-limit.ts');
        expect(other).toContain("from './rate-limits.config'");
        expect(other).not.toContain("from './security'");
        expect(other).toContain('Ratelimit.slidingWindow(apiLimit.maxRequests');
    });
});

/*
 * ── #644 MUTATION TESTING ───────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the module reads a second table again              KILLED
 *     the api bucket goes back to a number nobody applies            KILLED
 *     the env override is dropped from the window                    KILLED
 *     security.ts exports a colliding rateLimitConfig again          KILLED
 *     the two modules share one Upstash prefix                       KILLED
 *     the scope stops reaching the key                               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the reversal note                                       SURVIVED ✓
 *
 * ── THREE SURVIVED THE FIRST RUN, AND ALL THREE WERE MISSING ASSERTIONS ─────
 *
 *   Recorded because the pattern is now four findings old:
 *
 *     the module reads a second table again    Keeping the import and defining
 *                                              `const apiLimit = { … }` beside
 *                                              it satisfied "imports the right
 *                                              module". An import is not a use.
 *     the env override is dropped              Nothing asserted that the `api`
 *                                              bucket reads the environment —
 *                                              the capability that had to
 *                                              survive moving the number.
 *     security.ts exports it again             Nothing asserted the NAME is
 *                                              unique. The collision could come
 *                                              straight back while every other
 *                                              assertion stayed green.
 *
 *   None was a redundant rule. A surviving mutant is a question about the tests
 *   before it is a question about the code.
 */
