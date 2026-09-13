/**
 * @jest-environment node
 */

/**
 *   #692 THE RECORD WAS CORRECTED AND THE CACHE KEPT THE OLD ONE, TWENTY-FIVE
 *   TIMES.
 *
 *   `session-guard` decides what a signed-in member may do by reading their
 *   profile — `roles` and `serviceRegistrations` — from
 *   `CacheKeys.userProfile(userId)`, whose TTL is **300 seconds**. Every writer
 *   that changes those fields therefore has to clear that key, and twenty-five
 *   of them did not.
 *
 *   THE CACHE IS LIVE TODAY. I assumed it was not, because
 *   UPSTASH_REDIS_REST_URL is unset on this deployment and the audit's own
 *   notes say so. #459 had already closed that: `getCached` falls back to an
 *   in-process store rather than returning null, precisely so the caches would
 *   stop being no-ops. Checked before being believed, and the assumption was
 *   wrong — this is a five-minute window in production now, per instance, not
 *   a trap waiting for somebody to configure Redis.
 *
 * ── WHAT IT COST, BY DOOR ───────────────────────────────────────────────────
 *
 *     api/cooperative/verify-payment  three writes granting
 *                                     `cooperative_member` and marking the
 *                                     registration active — and NO invalidation
 *                                     anywhere in the file. The member pays, is
 *                                     redirected, and is refused by a cache.
 *                                     That is #668's shape ("told to pay again,
 *                                     after paying") reached by another road.
 *     the nine status-check heals     cooperative, wave, export, farm nation,
 *                                     academy. These are the member's OWN
 *                                     "check my status" path: it notices the
 *                                     record is wrong, corrects it, and the
 *                                     platform keeps answering from the copy it
 *                                     just corrected — to the very person who
 *                                     asked it to look again.
 *     module-access-check ×6          the same, one layer down: the heals exist
 *                                     to repair a member who has access and
 *                                     whose record denies it.
 *     user-soft-delete                writes `roles: ["deleted"]`,
 *                                     `isActive: false`, `suspended: true` —
 *                                     and a session already holding a token
 *                                     kept its old roles for five minutes. A
 *                                     new sign-in was always refused, so what
 *                                     survived is the request path, not login.
 *     six more                        enrolment, an earnings backfill, a
 *                                     recorded payment, three revision requests.
 *
 *   THIS IS THE MECHANISM BEHIND THE COMPLAINT THIS AUDIT RUNS UNDER — "every
 *   time we fix it, it breaks". The record IS correct. The thing reading it is
 *   not, for five minutes, and by the time anybody looks it has healed itself.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();

/**
 *   Comments removed, LINE NUMBERS KEPT.
 *
 *   A block comment collapsed to nothing shifts every line after it, and this
 *   sweep reports numbers a person then opens the file to. #632's lesson — and
 *   it bit during this finding: the first version of the sweep sent me to the
 *   wrong lines in five files before I noticed the offsets were computed on
 *   stripped source.
 */
const strip = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (l.trim().startsWith('//') ? '' : l)).join('\n');

const INVALIDATES = /invalidateUserCache|invalidateServiceCache|invalidateCooperativeCache|invalidateSellerCache|invalidateMultipleUsers|deleteCache\(\s*CacheKeys\.userProfile/;

/** Balanced-brace read of a call's arguments. */
function args(src: string, from: number): string {
    let depth = 1;
    let i = from;
    while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        i++;
    }
    return src.slice(from, i - 1);
}

function sources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
        }
    };
    for (const top of ['src', 'scripts']) {
        try { walk(join(ROOT, top)); } catch { /* absent tree is not a finding */ }
    }
    return out;
}

interface Write { file: string; line: number; fn: string; invalidates: boolean }

/** Every write that changes what session-guard caches. */
function profileWrites(): Write[] {
    const out: Write[] = [];
    for (const path of sources()) {
        const src = strip(readFileSync(path, 'utf8'));
        const rel = relative(ROOT, path).replace(/\\/g, '/');
        const ends = [...src.matchAll(/^\}/gm)].map((m) => m.index!);

        /*
         *   THE RECEIVER IS MATCHED EXACTLY, not by looking backwards.
         *
         *   The first version accepted any `.set(`/`.update(` with the words
         *   COLLECTIONS.USERS within 260 characters behind it, and reported
         *   forensics.ts — where the call is `learnerPlan.set(...)` on a
         *   JavaScript Map that happens to sit near a users query. A sweep that
         *   cannot tell a Map from a document reports defects that are not
         *   there, which is how a clean result stops meaning anything.
         */
        const RECEIVER = /(?:collection\(\s*COLLECTIONS\.USERS\s*\)\s*\.doc\([^)]*\)\s*\.(update|set)\s*\(|\b(?:userRef|usersRef|userDocRef)\s*\.(update|set)\s*\(|\b(?:transaction|t)\s*\.(update|set)\s*\(\s*(?:userRef|usersRef|userDocRef)\b)/g;

        for (const m of src.matchAll(RECEIVER)) {
            const at = m.index!;
            const payload = args(src, at + m[0].length);
            if (!/["']?\b(roles|serviceRegistrations)\b/.test(payload)) continue;

            const fnMatches = [...src.slice(0, at).matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)];
            const stop = ends.find((e) => e > at) ?? src.length;
            const startsBefore = ends.filter((e) => e < at);
            const begin = startsBefore.length ? startsBefore[startsBefore.length - 1] : 0;

            out.push({
                file: rel,
                line: src.slice(0, at).split('\n').length,
                fn: fnMatches.length ? fnMatches[fnMatches.length - 1][1] : '?',
                invalidates: INVALIDATES.test(src.slice(begin, stop)),
            });
        }
    }
    return out;
}

/**
 *   The writes that deliberately do not invalidate, with the reason.
 *
 *   A list rather than a count — #670's rule, after a cap on a number let
 *   twenty defects hide behind "fewer than thirty". An entry that stops being
 *   produced fails too, because an exemption that has stopped exempting
 *   anything has started hiding the next one.
 */
const EXEMPT: Record<string, string> = {
    'src/scripts/backfill_academy_plans.ts':
        'a one-shot script run from a terminal — there is no process holding a cached profile to clear',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#692 — a write that changes access clears the cache access is read from', () => {
    it('THE SWEEP IS READING THE APPLICATION', () => {
        //   The control for every claim below. A sweep that found nothing would
        //   report a clean platform.
        const writes = profileWrites();
        expect(sources().length).toBeGreaterThan(500);
        expect(writes.length).toBeGreaterThan(40);
    });

    it('AND IT CAN STILL TELL THE TWO APART', () => {
        /*
         *   The instrument, checked against answers known independently before
         *   any result is believed — the rule this audit runs under.
         *
         *   These two doors were repaired in this finding and read either way
         *   round: a sweep that called everything invalidated, or nothing,
         *   would pass the count above and be useless.
         */
        const writes = profileWrites();
        const byFile = (f: string) => writes.filter((w) => w.file === f);

        expect(byFile('src/app/api/cooperative/verify-payment/route.ts').length).toBeGreaterThan(0);
        for (const w of byFile('src/app/api/cooperative/verify-payment/route.ts')) {
            expect({ ...w, invalidates: w.invalidates }).toMatchObject({ invalidates: true });
        }

        //   And a file with no invalidation at all still reads as false — the
        //   exempt script is the honest negative sample.
        const script = byFile('src/scripts/backfill_academy_plans.ts');
        expect(script.length).toBeGreaterThan(0);
        expect(script.every((w) => !w.invalidates)).toBe(true);
    });

    it('THE DEFECT: every other write clears the profile key', () => {
        /*
         *   THE test. Twenty-five writes changed `roles` or
         *   `serviceRegistrations` and left `user:profile:{uid}` holding the
         *   value they had just replaced, for up to five minutes.
         */
        const stale = profileWrites()
            .filter((w) => !w.invalidates)
            .filter((w) => !(w.file in EXEMPT))
            .map((w) => `${w.file}:${w.line} ${w.fn}`);

        expect({ stale }).toEqual({ stale: [] });
    });

    it('AND EVERY EXEMPTION IS STILL EXEMPTING SOMETHING', () => {
        //   #670's rule. An exemption nobody needs any more is where the next
        //   one hides.
        const files = new Set(profileWrites().map((w) => w.file));
        for (const file of Object.keys(EXEMPT)) {
            expect({ file, stillWritesAProfile: files.has(file) })
                .toEqual({ file, stillWritesAProfile: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#692 — and the cache it clears is the one the guard reads', () => {
    const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

    it('SESSION-GUARD READS CacheKeys.userProfile', () => {
        //   The premise. If the guard stopped reading that key this whole
        //   finding would be about nothing, and this says so out loud.
        const guard = strip(read('src/lib/session-guard.ts'));
        expect(guard).toContain('CacheKeys.userProfile(session.user.id)');
        expect(guard).toContain('getCached(cacheKey)');
    });

    it('AND EVERY INVALIDATOR CLEARS THAT SAME KEY', () => {
        /*
         *   Four functions are treated as sufficient by the sweep above. If one
         *   of them stopped clearing the profile key, every caller that reaches
         *   for it would still read as repaired and none of them would be.
         */
        const src = strip(read('src/lib/cache-invalidation.ts'));
        for (const fn of ['invalidateUserCache', 'invalidateSellerCache',
            'invalidateCooperativeCache', 'invalidateServiceCache']) {
            const at = src.indexOf(`export async function ${fn}`);
            expect({ fn, found: at > -1 }).toEqual({ fn, found: true });
            const body = src.slice(at, src.indexOf('\n}', at));
            expect({ fn, clearsProfile: body.includes('CacheKeys.userProfile(userId)') })
                .toEqual({ fn, clearsProfile: true });
        }
    });

    it('AND deleteCache REACHES THE STORE getCached ACTUALLY USED', () => {
        /*
         *   The half that would make every invalidation above a no-op, and the
         *   assumption I had to check rather than carry: without Upstash,
         *   getCached does NOT return null — #459 gave it an in-process
         *   fallback. An invalidation that only spoke to Redis would clear
         *   nothing on this deployment while appearing to work.
         */
        const redis = strip(read('src/lib/redis.ts'));
        expect(redis).toContain('if (!isRedisConfigured) return getFallbackCache<T>(key);');
        expect(redis).toContain('if (!isRedisConfigured) return deleteFallbackCache(key);');
    });

    it('AND THE WINDOW IS THE ONE THIS FINDING CLAIMS', () => {
        //   Five minutes, asserted rather than asserted-in-prose, so the number
        //   in this file's header cannot quietly stop being true.
        const redis = strip(read('src/lib/redis.ts'));
        const ttl = /USER_PROFILE:\s*(\d+)/.exec(redis);
        expect(ttl).not.toBeNull();
        expect(Number(ttl![1])).toBe(300);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the paid member's profile cache is left stale       KILLED
 *     a scrubbed account keeps its cached roles                       KILLED
 *     the access heals stop clearing the profile                      KILLED
 *     invalidateServiceCache stops clearing the profile key           KILLED
 *     deleteCache stops reaching the in-process fallback (#459)       KILLED
 *     the profile TTL is quietly widened                              KILLED
 *     the sweep is narrowed to nothing                                KILLED
 *     the sweep calls everything invalidated                          KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── THE SWEEP WAS WRONG TWICE BEFORE IT WAS BELIEVED ────────────────────────
 *
 *   Both faults were in the instrument, and both were found by checking it
 *   against answers known independently rather than by reading its output.
 *
 *     Line numbers computed on STRIPPED source. A collapsed block comment
 *     shifts everything after it, and the first version sent me to the wrong
 *     lines in five files. #632, met again; the strip here keeps the count.
 *
 *     A receiver matched by LOOKING BACKWARDS 260 characters for the words
 *     COLLECTIONS.USERS. That reported forensics.ts, where the call is
 *     `learnerPlan.set(...)` on a JavaScript Map sitting near a users query.
 *     Matching the receiver exactly removed that false positive AND found
 *     THREE MORE REAL ONES the loose version had missed — including
 *     _withdrawEarningsAction, where the stale profile shows a member money
 *     they have already withdrawn.
 *
 *   A sweep that is wrong in both directions at once is the ordinary case, not
 *   the surprising one, which is why the two instrument tests above come first.
 */
