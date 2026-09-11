/**
 * @jest-environment node
 */

/**
 *   #643 TWELVE ROUTES DRAWING ON ONE BUDGET.
 *
 *   This platform has TWO rate-limiting modules:
 *
 *     lib/rate-limiter.ts  + rate-limits.config.ts   named buckets, each with
 *                                                    its own key space
 *     lib/rate-limit.ts    + security.ts             ONE generic bucket,
 *                                                    `RATE_LIMIT_MAX_REQUESTS`
 *                                                    (default 200/minute),
 *                                                    under a single prefix
 *
 *   `rate-limits.config.ts` describes the failure this file is about, in its own
 *   header, about the FIRST module:
 *
 *       Without it every limiter built here shared one key per identifier …
 *       and the failure was silent: a member was refused a withdrawal because
 *       they had used the app.
 *
 *   The repair was to make `name` a REQUIRED field and put it in the prefix. It
 *   reached `lib/rate-limiter.ts` and not `lib/rate-limit.ts`, whose
 *   `withRateLimit` wrapper keyed on the identity ALONE. So a single member's
 *
 *     MFA setup, enable, disable, status and verify
 *     QR verification
 *     cooperative loan application
 *     BVN, NIN and business KYC submissions
 *     two admin password-reset endpoints
 *     the admin Paystack reconciliation
 *
 *   all spent one allowance. Enrolling in MFA could refuse a loan application;
 *   submitting a BVN could refuse a QR scan. Nothing would have said why.
 *
 *   The fourth time in this area that a control reached one of two doors, after
 *   #274, #527 and #642 — and the third where the phrase that fits is the one
 *   #527 used: the strict limit went to the quiet door.
 *
 * ── WHAT THIS CHANGES, AND WHAT IT DOES NOT ─────────────────────────────────
 *
 *   The scope enters the KEY, not the size. No route becomes more restricted
 *   than it was; they stop spending each other's budget. That is why this is
 *   safe to do in one change across thirteen call sites.
 *
 *   The parameter is REQUIRED rather than optional, for the reason the other
 *   module gives for the same field: an optional name is a name nobody passes,
 *   and the typechecker naming all thirteen sites is the point.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

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

const ROUTES = walk(join(ROOT, 'src/app/api'))
    .map((f) => relative(ROOT, f))
    .filter((f) => /route\.tsx?$/.test(f));

/** Every `withRateLimit(handler, "scope")` in the application. */
function wrappedRoutes(): Array<{ file: string; scope: string | null }> {
    const out: Array<{ file: string; scope: string | null }> = [];
    for (const file of ROUTES) {
        const src = code(file);
        for (const m of src.matchAll(/withRateLimit\(\s*(\w+)\s*(?:,\s*["'`]([\w-]+)["'`])?/g)) {
            out.push({ file, scope: m[2] ?? null });
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#643 — every wrapped route names its own key space', () => {
    const wrapped = wrappedRoutes();

    it('THE SWEEP FINDS THE ROUTES IT IS ABOUT — a positive control', () => {
        /*
         *   Without this, a regex that matched nothing would make every
         *   assertion below pass over a codebase that still pools. Thirteen
         *   call sites across twelve routes; the admin password-reset file
         *   wraps two methods.
         */
        expect(wrapped.length).toBe(13);
        expect(new Set(wrapped.map((w) => w.file)).size).toBe(12);
    });

    it('AND NOT ONE OF THEM IS UNNAMED', () => {
        const unnamed = wrapped.filter((w) => w.scope === null).map((w) => w.file);
        expect({ unnamed }).toEqual({ unnamed: [] });
    });

    it('AND NO TWO ROUTES SHARE A SCOPE', () => {
        /*
         *   The half that matters. "Everybody has a name" is also satisfied by
         *   thirteen routes all passing "api", which is the pooling this finding
         *   is about wearing a label.
         */
        const scopes = wrapped.map((w) => w.scope!);
        const duplicated = scopes.filter((s, i) => scopes.indexOf(s) !== i);
        expect({ duplicated }).toEqual({ duplicated: [] });
    });

    it('AND THE SCOPE IS REQUIRED BY THE TYPE, not merely supplied', () => {
        /*
         *   An optional name is a name nobody passes. The typechecker naming
         *   all thirteen sites when this parameter was introduced is what made
         *   the change complete rather than partial — which is the difference
         *   between this repair and the one that reached only the other module.
         */
        const lib = code('src/lib/rate-limit.ts');
        //   Required on the wrapper AND on the function beneath it. An optional
        //   parameter on the low-level call is a door the pooling can come back
        //   through: one caller reaching past withRateLimit and omitting it
        //   puts that route back in everybody's budget.
        expect((lib.match(/\n\s*scope: string,\n/g) ?? []).length).toBe(2);
        expect(lib).not.toMatch(/scope\?: string/);
        //   And the key is built unconditionally, so there is no un-scoped
        //   branch left to fall into.
        expect(lib).toContain('const key = `${scope}:${identity}`;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#643 — and the scope reaches the key, on both paths', () => {
    const lib = code('src/lib/rate-limit.ts');

    it('THE KEY CARRIES IT', () => {
        expect(lib).toContain('const key = `${scope}:${identity}`;');
    });

    it('AND THE IN-MEMORY FALLBACK USES THE SAME KEY', () => {
        /*
         *   Namespacing only the Redis path would leave every limit colliding
         *   again the moment Upstash is unreachable — which is precisely when a
         *   member is least able to tell a rate limit from an outage. That is
         *   lib/rate-limiter.ts's own note, and it applies here identically:
         *   `UPSTASH_REDIS_REST_URL` is not set on this deployment, so the
         *   fallback is the live path today.
         */
        expect(lib).toContain('return apiFallbackDecision(key);');
        //   Twice — the no-Redis branch and the Redis-error branch.
        expect((lib.match(/apiFallbackDecision\(key\)/g) ?? []).length).toBe(2);
    });

    it('AND THE IDENTITY IS STILL THE ACCOUNT WHERE THERE IS ONE', () => {
        //   #260's rule, unchanged by this: the scope narrows the key space, it
        //   does not replace who the budget belongs to.
        expect(lib).toContain('const identity =');
        expect(lib).toContain('clientIpFromHeaders(request.headers)');
        expect(lib).toContain("'anonymous'");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#643 — the scopes name the routes they guard', () => {
    it('EACH ONE IS RECOGNISABLE FROM ITS PATH', () => {
        /*
         *   A key space is read by a person looking at Redis or at a log line,
         *   so "scope-7" would satisfy every assertion above and help nobody.
         *   Each scope has to share a word with its own route path.
         */
        for (const { file, scope } of wrappedRoutes()) {
            const segments = file
                .replace(/^src\/app\/api\//, '')
                .replace(/\/route\.tsx?$/, '')
                .split('/');
            const words = new Set(segments.flatMap((s) => s.split('-')));
            const scopeWords = scope!.split('-');
            expect({ file, scope, recognisable: scopeWords.some((w) => words.has(w)) })
                .toEqual({ file, scope, recognisable: true });
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the scope stops reaching the key                    KILLED
 *     THE DEFECT: two routes are given the same scope                 KILLED
 *     the scope becomes optional again                                KILLED
 *     a route loses its scope                                         KILLED
 *     the fallback path stops seeing the scope                        KILLED
 *     a scope is renamed to something unrecognisable                  KILLED
 *     the identity stops falling back to the address                  KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   "Two routes are given the same scope" is the one that would pass a check
 *   written as "everybody has a name", and is the pooling this finding is about
 *   wearing a label.
 *
 *   "The fallback path stops seeing the scope" is the one that would be
 *   invisible in production as it stands: `UPSTASH_REDIS_REST_URL` is not set
 *   on this deployment, so the in-memory fallback IS the live path, and a fix
 *   that namespaced only Redis would have changed nothing at all while reading
 *   as complete.
 */
