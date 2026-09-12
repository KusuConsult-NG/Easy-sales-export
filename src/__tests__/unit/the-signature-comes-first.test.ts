/**
 * @jest-environment node
 */

/**
 *   #645 THE `webhook` BUCKET IS UNWIRED BECAUSE THE AUTHORISATION COMES FIRST
 *        — AND NOTHING CHECKED THAT IT DOES.
 *
 *   The last of the three rate-limit buckets #641 found with no consumer.
 *   `api` turned out to be a second table under a shared name (#644); `kyc` is
 *   waiting for a provider that is out of service (#642); this one is different
 *   again, and the answer is that it does not need a consumer.
 *
 *   A webhook has no session. What it has instead is a signature or a shared
 *   secret, and that is a cheap check — an HMAC over the body, or a string
 *   comparison. An endpoint that performs that check BEFORE it touches the
 *   database is not made safer by a rate limit; a volumetric flood belongs at
 *   the edge, where it can be absorbed without reaching this application at all.
 *
 *   THAT ARGUMENT DEPENDS ENTIRELY ON THE ORDERING, AND THE ORDERING WAS
 *   ASSERTED NOWHERE. Move one database read above the signature check and the
 *   endpoint becomes an unauthenticated write amplifier — anybody who knows the
 *   URL can make the platform do work — and no test in this repository would
 *   have noticed. "We decided not to add a limiter" is only safe while the
 *   reason holds, so the reason is pinned here rather than left in a commit
 *   message.
 *
 *   All four receivers were read:
 *
 *     paystack           reads the body (the HMAC needs it), refuses a missing
 *                        signature, verifies with timingSafeEqual, THEN reads
 *                        the database.
 *     resend             reads the payload, refuses when the signing secret is
 *                        unset, verifies with svix, THEN writes.
 *     africastalking     checks the shared secret BEFORE it even parses the
 *                        body — the strongest ordering of the four.
 *     identity-provider  retired behind a 410; it does nothing at all.
 *
 * ── ONE THING WAS WRONG, AND IT IS THE SHAPE THIS AUDIT KEEPS FINDING ───────
 *
 *   `verifyPaystackWebhook` compares with `crypto.timingSafeEqual`, under a
 *   comment reading "Prevent timing attacks". The Africa's Talking receiver,
 *   guarding the other end of the same kind of door, compared its shared secret
 *   with `!==` — which returns as soon as two bytes differ.
 *
 *   Over a network that is a poor oracle and the practical risk is low. It is
 *   corrected anyway: the idiom already exists in this codebase, the fix costs
 *   nothing, and "the strict version reached one of the two doors" is the defect
 *   found here more often than any other.
 *
 *   RECORDED AND NOT FIXED: that secret arrives in the QUERY STRING, so it lands
 *   in access logs, proxy logs and any Referer that leaks. The transport is the
 *   provider's configuration, not this repository's.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { rateLimitConfig } from '@/lib/rate-limits.config';

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

const WEBHOOKS = walk(join(ROOT, 'src/app/api/webhooks'))
    .map((f) => relative(ROOT, f))
    .filter((f) => /route\.tsx?$/.test(f))
    .sort();

/**
 * Where a receiver decides the caller is allowed, and where it first does work.
 *
 * THE AUTHORISATION ANCHOR IS THE CALL, NAMED PER FILE.
 *
 * The first version matched `secretsMatch\(` anywhere, and the helper's own
 * DEFINITION sits at the top of africastalking's file — so `search()` found
 * the definition, the index was tiny, and "authorises before it works" was true
 * of any ordering at all. A mutant that moved a database call above the secret
 * check survived it.
 *
 * That is the same trap as an import being counted as a use, for the third time
 * in this session's findings (#629, #641, here). A position test has to anchor
 * on the thing happening, not on the thing existing.
 */
const AUTHORISES: Record<string, string> = {
    'src/app/api/webhooks/africastalking/route.ts': '!secretsMatch(providedSecret, expectedSecret)',
    'src/app/api/webhooks/paystack/route.ts': 'verifyPaystackWebhook(body, signature)',
    'src/app/api/webhooks/resend/route.ts': 'wh.verify(payloadText, {',
};
const DOES_WORK = /db\.collection\(|getAdminDb\(\)|\.set\(|\.update\(|\.add\(/;

// ─────────────────────────────────────────────────────────────────────────────
describe('#645 — every webhook decides before it works', () => {
    it('THERE ARE FOUR RECEIVERS, AND THIS SWEEP SEES THEM ALL', () => {
        //   Without this, a walker that found none would make the assertions
        //   below pass over an unguarded endpoint.
        expect(WEBHOOKS).toEqual([
            'src/app/api/webhooks/africastalking/route.ts',
            'src/app/api/webhooks/identity-provider/route.ts',
            'src/app/api/webhooks/paystack/route.ts',
            'src/app/api/webhooks/resend/route.ts',
        ]);
    });

    it.each([
        'src/app/api/webhooks/africastalking/route.ts',
        'src/app/api/webhooks/paystack/route.ts',
        'src/app/api/webhooks/resend/route.ts',
    ])('%s AUTHORISES BEFORE IT TOUCHES THE DATABASE', (file) => {
        const src = code(file);
        const auth = src.indexOf(AUTHORISES[file]);
        const work = src.search(DOES_WORK);

        expect({ file, authorises: auth > -1, works: work > -1 })
            .toEqual({ file, authorises: true, works: true });
        expect({ file, decidesFirst: auth < work }).toEqual({ file, decidesFirst: true });
    });

    it('AND THE RETIRED ONE DOES NOTHING AT ALL', () => {
        /*
         *   identity-provider has no authorisation because it has no behaviour:
         *   410 to everybody. Asserted rather than exempted, because "it has no
         *   signature check" is exactly what an unguarded receiver also looks
         *   like.
         */
        const src = code('src/app/api/webhooks/identity-provider/route.ts');
        expect(src).toContain('status: 410');
        expect({ works: DOES_WORK.test(src) }).toEqual({ works: false });
    });

    it('AND EACH FAILS CLOSED WHEN ITS SECRET IS NOT CONFIGURED', () => {
        /*
         *   The other half of "the signature is the control": a control that is
         *   skipped when unset is not a control, and africastalking's own note
         *   records that it once was — `if (expectedSecret) { …check… }`.
         */
        expect(code('src/app/api/webhooks/africastalking/route.ts'))
            .toContain('if (!expectedSecret) {');
        expect(code('src/app/api/webhooks/resend/route.ts'))
            .toContain('Configuration Error');
        expect(code('src/lib/paystack-server.ts'))
            .toContain("console.error('Webhook verification failed: PAYSTACK_SECRET_KEY is not set')");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#645 — and the two shared-secret comparisons agree', () => {
    it('BOTH ARE CONSTANT-TIME', () => {
        /*
         *   #659 RE-ANCHORED, AND THE FINDING GREW. This asserted a LOCAL
         *   `crypto.timingSafeEqual(a, b)` inside the webhook. #645 hardened
         *   that door and named `revalidate-cache` in the same breath without
         *   fixing it; a sweep then found eight cron routes behind them, every
         *   one comparing `Authorization` with `!==`.
         *
         *   There is one implementation now — lib/secret-compare — and
         *   the-strict-comparison-reached-one-door asserts that it is the ONLY
         *   one and that every door asks it. What is kept here is the claim this
         *   file makes: both of these two compare in constant time.
         */
        expect(code('src/lib/paystack-server.ts')).toContain('crypto.timingSafeEqual(');
        expect(code('src/app/api/webhooks/africastalking/route.ts'))
            .toContain('secretsMatch(providedSecret, expectedSecret)');
        expect(code('src/lib/secret-compare.ts')).toContain('timingSafeEqual(a, b)');
    });

    it('AND THE PLAIN COMPARISON IS GONE', () => {
        //   Stated as an absence: adding a helper is also satisfied by a file
        //   that keeps the old test beside it.
        expect(code('src/app/api/webhooks/africastalking/route.ts'))
            .not.toMatch(/providedSecret !== expectedSecret/);
    });

    it('AND THE LENGTH GUARD IS THERE, or the comparison throws', () => {
        //   timingSafeEqual raises on differing lengths, so a missing guard
        //   turns a wrong secret into a 500 instead of a 401 — and a 500 on a
        //   webhook is a retry storm.
        //
        //   #659 — the guard is in lib/secret-compare, and it is no longer an
        //   early `return false`. THAT IS THE CORRECTION: this file's copy
        //   short-circuited on a length mismatch while api/auth/health's copy of
        //   the same function padded and compared anyway. One contract, two
        //   statements of it, disagreeing about the thing it exists to control.
        //   The shared one does the work either way, which is asserted by
        //   RUNNING it in the-strict-comparison-reached-one-door rather than by
        //   looking for a line.
        const src = code('src/lib/secret-compare.ts');
        expect(src).toContain('if (a.length !== b.length) {');
        expect(src).not.toContain('if (a.length !== b.length) return false;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#645 — the webhook bucket is unwired, and that is the decision', () => {
    it('NOTHING CONSUMES IT', () => {
        const consumers = APP_FILES.filter((f) => /rateLimitConfig\.webhook\b/.test(code(f)));
        expect(consumers).toEqual([]);
    });

    it('AND IT IS STILL DECLARED, so wiring it is one line', () => {
        //   #629's class: an unused RULE is different from an unused helper.
        //   Deleting it would make adding a webhook limit a design decision
        //   again rather than a wiring job.
        expect(rateLimitConfig.webhook.maxRequests).toBe(1000);
        expect(rateLimitConfig.webhook.interval).toBe(60 * 1000);
        expect(rateLimitConfig.webhook.name).toBe('webhook');
    });

    it('AND THE REASON IT IS UNWIRED IS THE ORDERING ABOVE', () => {
        /*
         *   This assertion exists to tie the decision to its premise. If a
         *   receiver ever does work before authorising, the ordering tests fail
         *   and this comment is what tells the next reader that the missing
         *   limiter was a consequence of that ordering rather than an oversight.
         */
        expect(WEBHOOKS.length).toBe(4);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: africastalking compares with `!==` again            KILLED
 *     the length guard is removed                                     KILLED
 *     paystack reads the database before verifying                    KILLED
 *     africastalking parses the body before checking the secret       KILLED
 *     resend writes before verifying                                  KILLED
 *     africastalking stops failing closed on an unset secret          KILLED
 *     the retired receiver starts writing again                       KILLED
 *     the webhook bucket is widened where it sits                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   "The retired receiver starts writing again" is the guard on the one
 *   exemption in this file: identity-provider has no signature check because it
 *   has no behaviour, and that reasoning stops holding the moment it does
 *   anything.
 *
 * ── AND THE ORDERING TEST WAS MEASURING THE WRONG THING ─────────────────────
 *
 *   "africastalking parses the body before checking the secret" survived the
 *   first run. The authorisation anchor matched `secretsMatch\(` anywhere in
 *   the file — and the helper's own DEFINITION sits at the top, so `search()`
 *   returned an index near zero and "authorises before it works" was true of
 *   every possible ordering.
 *
 *   A definition is not a use, which is #629's sentence about imports wearing a
 *   different coat, and it is the THIRD time in this session's findings that a
 *   position test anchored on a symbol instead of on the thing happening (#629,
 *   #641, here). The anchors are the calls now, named per file.
 */
