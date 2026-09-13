/**
 * @jest-environment node
 */

/**
 *   #661 HALF A CREDENTIAL WAS REPORTED AS NONE.
 *
 *   This audit's owner-side list carries: "Set UPSTASH_REDIS_REST_URL — only the
 *   token is set, so every rate limiter uses a per-instance in-memory fallback."
 *
 *   That is the state the production deployment is in, and NOTHING IN THE
 *   APPLICATION COULD SAY SO. `isRedisConfigured` is `url && token`, so:
 *
 *     neither set   →  isRedisConfigured = false
 *     token only    →  isRedisConfigured = false     ← the deployment
 *     both set      →  isRedisConfigured = true
 *
 *   and every consumer of that flag — the startup log, the `/admin/system-health`
 *   tile, every rate limiter and the cache — treated the middle row as the top
 *   row. The log said "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not
 *   set" to somebody who had set one of them, and named neither as the missing
 *   one. The tile said "Disconnected".
 *
 *   Those two situations are not the same thing:
 *
 *     NEITHER is a CHOICE. Local work, a preview environment, a deployment that
 *     does not want a shared cache. Falling back quietly is correct.
 *
 *     ONE is a MISTAKE. Nobody sets half of a credential pair on purpose.
 *     Somebody believed they had configured Upstash and walked away, and every
 *     rate limiter on the platform is using a per-instance in-memory fallback
 *     that shares no state between server instances — so the withdrawal limit,
 *     the login limit and the bank-verification oracle control are each per
 *     container rather than per platform.
 *
 *   "Could not tell" rendered as "no" — the class #620 and #621 are filed
 *   under, reached this time through a boolean that answered a question nobody
 *   had asked it.
 *
 * ── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ─────────────────────────────
 *
 *   The three states are named and reported. The half-configured one is an
 *   ERROR at startup rather than a warning, says WHICH variable is missing, and
 *   the health tile shows it instead of "Disconnected".
 *
 *   `isRedisConfigured` is UNCHANGED, and that is deliberate. Half a credential
 *   pair cannot be used to reach Upstash; the fallback is still the right
 *   behaviour and every caller still takes it. What was broken was the
 *   REPORTING, and turning a misconfiguration into a crash would take a working
 *   platform down over a cache.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';
import { redisConfigState, missingRedisVariable, presenceOf, describePresence } from '@/lib/redis';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

const URL_VAR = 'UPSTASH_REDIS_REST_URL';
const TOKEN_VAR = 'UPSTASH_REDIS_REST_TOKEN';

const env = (url?: string, token?: string): NodeJS.ProcessEnv => {
    //   NODE_ENV is required on this project's ProcessEnv type, so a bare {}
    //   does not typecheck. It plays no part in what is under test.
    const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    if (url !== undefined) e[URL_VAR] = url;
    if (token !== undefined) e[TOKEN_VAR] = token;
    return e;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#661 — the three states are three, not two', () => {
    it('THE DEPLOYMENT THIS WAS FOUND ON IS HALF-CONFIGURED, AND SAYS WHICH HALF', () => {
        //   THE defect. The token is set and the URL is not — the exact state
        //   the owner-side list records — and this used to be indistinguishable
        //   from never having heard of Upstash.
        expect(redisConfigState(env(undefined, 'a-token'))).toBe('half-configured');
        expect(missingRedisVariable(env(undefined, 'a-token'))).toBe(URL_VAR);
    });

    it('AND SO IS THE OTHER WAY ROUND', () => {
        expect(redisConfigState(env('https://upstash.example', undefined))).toBe('half-configured');
        expect(missingRedisVariable(env('https://upstash.example', undefined))).toBe(TOKEN_VAR);
    });

    it('NEITHER IS "absent", WHICH IS A CHOICE AND NOT A MISTAKE', () => {
        /*
         *   The positive control that keeps this from being "warn louder about
         *   everything". A laptop, a preview build and a deployment that does
         *   not want a shared cache are all in this state on purpose, and
         *   telling them a variable is missing is the noise #658 was about.
         */
        expect(redisConfigState(env())).toBe('absent');
        expect(missingRedisVariable(env())).toBeNull();
    });

    it('AND BOTH IS "configured", WITH NOTHING MISSING', () => {
        expect(redisConfigState(env('https://upstash.example', 'a-token'))).toBe('configured');
        expect(missingRedisVariable(env('https://upstash.example', 'a-token'))).toBeNull();
    });

    it('AN EMPTY STRING IS NOT A VALUE', () => {
        //   `UPSTASH_REDIS_REST_URL=` in a dotenv file sets the variable to "",
        //   which is falsy — so it is absent, not half-configured. The same
        //   reading isRedisConfigured has always taken.
        expect(redisConfigState(env('', 'a-token'))).toBe('half-configured');
        expect(redisConfigState(env('', ''))).toBe('absent');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#716 — "not set" was said to somebody looking at the variable', () => {
    /*
     *   THE OWNER ANSWERED THIS LOG LINE WITH "this IS set", TWICE:
     *
     *       [Redis] UPSTASH_REDIS_REST_URL IS NOT SET, and its partner is.
     *
     *   And they were right, and so was the application. A variable in a
     *   hosting dashboard can EXIST WITH AN EMPTY VALUE — the row is there,
     *   the name is right, the box is blank, which is exactly what a reference
     *   like ${{Redis.URL}} leaves when it fails to resolve. `process.env.X` is
     *   then "", the truthiness test read falsy, and the message chose the one
     *   wording that makes the person reading it wrong.
     *
     *   Three states, and the two that are not "set" send an operator to
     *   different places: one to ADD a variable, the other to look at the one
     *   already sitting there.
     */

    it('A VARIABLE THAT IS NOT THERE AND ONE THAT IS THERE AND BLANK ARE DIFFERENT', () => {
        expect(presenceOf(undefined)).toBe('missing');
        expect(presenceOf('')).toBe('empty');
        expect(presenceOf('https://upstash.example')).toBe('set');
    });

    it('AND WHITESPACE IS BLANK, WHICH IS THE WORSE HALF OF THIS', () => {
        /*
         *   A stray space or a pasted newline is TRUTHY. The old test built a
         *   real Upstash client against it, so `isRedisConfigured` was true and
         *   the platform reported a shared cache it did not have — while the
         *   fallbacks that exist and work sat unused. Being wrong in this
         *   direction costs more than being unconfigured.
         */
        expect(presenceOf('   ')).toBe('empty');
        expect(presenceOf('\n')).toBe('empty');
        expect(redisConfigState(env('   ', 'a-token'))).toBe('half-configured');
        expect(redisConfigState(env('  ', '  '))).toBe('absent');
    });

    it('AND THE MESSAGE SAYS WHICH OF THE TWO IT FOUND', () => {
        expect(describePresence(URL_VAR, undefined)).toContain('IS NOT PRESENT');
        //   The wording the owner's correction demands: not "you did not set
        //   it", but "the thing you set is carrying nothing".
        const blank = describePresence(URL_VAR, '');
        expect(blank).toContain('IS PRESENT BUT ITS VALUE IS BLANK');
        expect(blank).not.toContain('IS NOT PRESENT');
        expect(blank).toContain(URL_VAR);
    });

    it('AND A BLANK URL STILL NAMES THE URL AS THE ONE TO FIX', () => {
        //   missingRedisVariable has to agree with the new reading, or the
        //   message names one variable and describes the other.
        expect(missingRedisVariable(env('', 'a-token'))).toBe(URL_VAR);
        expect(missingRedisVariable(env('  ', 'a-token'))).toBe(URL_VAR);
        expect(missingRedisVariable(env('https://upstash.example', '   '))).toBe(TOKEN_VAR);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#661 — and the mistake is reported differently from the choice', () => {
    const REDIS = code('src/lib/redis.ts');

    it('HALF-CONFIGURED IS AN ERROR, NOT A WARNING', () => {
        /*
         *   Somebody set one of these on purpose and believes the platform has a
         *   shared cache. That is worth more than the line a correctly
         *   unconfigured laptop prints on every boot.
         */
        const branch = REDIS.slice(REDIS.indexOf('if (missing) {'));
        const body = branch.slice(0, branch.indexOf('} else {'));

        expect(body).toContain('console.error(');
        expect(body).toContain('HALF-CONFIGURED');
        /*
         *   And it names the variable rather than listing both.
         *
         *   THIS ASSERTION WAS `toContain('${missing}')` AND IT FIRED WHEN
         *   #716 CHANGED THE WORDING — correctly, which is what a ratchet is
         *   for. It is rewritten rather than relaxed: the property #661 bought
         *   is "the message names the ONE variable at fault", and pinning the
         *   exact interpolation spelling made it also mean "and never improve
         *   how you say it". The variable still reaches the message; it now
         *   goes through describePresence so the line can distinguish a
         *   variable that is absent from one that exists carrying nothing.
         */
        expect(body).toMatch(/describePresence\(\s*missing/);
        expect(body).not.toContain('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');
    });

    it('AND THE UNCONFIGURED CASE KEEPS ITS WARNING', () => {
        //   The other half. "Report the mistake louder" is also satisfied by
        //   shouting at every deployment, which is how a log stops being read.
        const elseAt = REDIS.indexOf('} else {');
        const body = REDIS.slice(elseAt, REDIS.indexOf('}', REDIS.indexOf('console.warn(', elseAt)));

        expect(body).toContain('console.warn(');
        expect(body).not.toContain('HALF-CONFIGURED');
    });

    it('AND isRedisConfigured IS UNCHANGED, SO NOTHING TRIES TO USE HALF A CREDENTIAL', () => {
        /*
         *   Deliberate, and worth pinning: half a pair cannot reach Upstash, so
         *   the fallback is still correct and every caller still takes it. What
         *   was broken was the reporting. A fix that made this state "configured"
         *   would turn a quiet misconfiguration into a platform that cannot
         *   rate-limit anything.
         */
        expect(REDIS).toContain('export const isRedisConfigured = !!(redisUrl && redisToken && !isTestRun);');
    });

    it('AND redisUrl / redisToken ARE TRIMMED BEFORE THAT TEST EVER RUNS', () => {
        /*
         *   #716, AND THE HALF OF IT THAT COSTS MORE. The line above is a
         *   truthiness test, which is correct ONLY IF the two values it reads
         *   have already had blank-but-truthy content removed. Without the trim,
         *   a value of "   " — a stray space, a pasted newline, a quoted empty
         *   string — makes isRedisConfigured TRUE, builds a real Upstash client
         *   against an unusable URL, and the platform reports a shared cache it
         *   does not have while the working fallbacks sit unused.
         *
         *   A MUTANT THAT REMOVED THIS TRIM SURVIVED EVERY OTHER TEST IN THIS
         *   FILE, because they all go through redisConfigState — the reporting
         *   path — and none of them touched the two module-scope constants that
         *   decide whether a client is CONSTRUCTED. Two readings of the same
         *   environment, one tested and one not, which is this audit's most
         *   frequent finding aimed at its own suite.
         *
         *   Asserted on the source because both constants are resolved once at
         *   module load, before any test can set process.env.
         */
        expect(REDIS).toContain('const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() || undefined;');
        expect(REDIS).toContain('const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || undefined;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#661 — and the screen says it too', () => {
    it('THE HEALTH REPORT CARRIES THE STATE, NOT JUST A BOOLEAN', () => {
        const health = code('src/app/actions/health.ts');
        expect(health).toContain('redisConfig: redisConfigState()');
        expect(health).toContain('redisMissingVariable: missingRedisVariable()');
    });

    it('AND THE TILE NAMES THE MISSING VARIABLE INSTEAD OF SAYING "Disconnected"', () => {
        /*
         *   The end of the chain, and the only part the owner will ever see. A
         *   red tile that says "Disconnected" is what this deployment has shown
         *   all along while one variable away from working.
         */
        const page = code('src/app/admin/system-health/page.tsx');
        expect(page).toContain("redisConfig === 'half-configured'");
        expect(page).toContain('redisMissingVariable');
        //   And the two kinds of "no" are no longer one string.
        expect(page).toContain('Disconnected — not configured');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: half-configured collapses back into absent          KILLED
 *     the missing variable is named the wrong way round               KILLED
 *     an unconfigured deployment is called half-configured            KILLED
 *     the half-configured case drops to a warning                     KILLED
 *     the unconfigured case is raised to an error                     KILLED
 *     isRedisConfigured starts accepting half a credential            KILLED
 *     the health report stops carrying the state                      KILLED
 *     the tile goes back to one "Disconnected" for both               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The state itself is the measurement: the owner-side list records that only
 *   the token is set on the deployment, and every one of the four consumers of
 *   `isRedisConfigured` was read to confirm that none of them could tell that
 *   apart from Upstash never having been configured.
 */
