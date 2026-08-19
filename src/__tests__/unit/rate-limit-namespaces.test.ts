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

describe('the other limiter module is deliberately untouched', () => {
    it('lib/rate-limit.ts keeps its single global bucket', () => {
        // Different module, different prefix, and ONE config — its callers all
        // share the platform-wide API budget on purpose, so there is nothing to
        // separate. Named so the asymmetry reads as a decision.
        const other = code('src/lib/rate-limit.ts');
        expect(other).toContain('prefix: "@upstash/ratelimit"');
        expect(other).not.toContain('ratelimit_custom');
    });

    it('and it takes no per-call config, which is why', () => {
        expect(code('src/lib/rate-limit.ts')).toContain('Ratelimit.slidingWindow(rateLimitConfig.maxRequests');
    });
});
