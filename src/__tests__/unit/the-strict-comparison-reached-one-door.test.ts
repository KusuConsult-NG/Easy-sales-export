/**
 * @jest-environment node
 */

/**
 *   #659 THE CONSTANT-TIME COMPARISON REACHED ONE DOOR OF ELEVEN.
 *
 *   #645 changed the Africa's Talking webhook from `!==` to `timingSafeEqual`,
 *   and wrote its own reason down:
 *
 *       "the idiom already exists in this codebase, the fix costs nothing, and
 *        'the strict version went to one of the two doors' is the defect this
 *        audit has found more than any other."
 *
 *   It named the other door IN THE SAME SENTENCE. The sweep in
 *   every-api-route-has-a-door records: "africastalking and revalidate-cache
 *   came back 'no auth'. Both compare a shared secret from process.env." Only
 *   the first was hardened.
 *
 *   A sweep for the shape found EIGHT MORE behind it — every cron route in the
 *   application:
 *
 *     age-notifications        close-export-windows     gdpr-purge
 *     process-email-queue      reconcile-fulfilment     reconcile-paystack
 *     release-escrow           release-stale-reservations
 *
 *   all comparing `Authorization` against `` `Bearer ${cronSecret}` `` with
 *   plain `!==`. Those are the triggers that release escrow, pay sellers, purge
 *   accounts and reconcile Paystack.
 *
 *   Eleven doors, one of them strict. The eleventh — lib/digital-id — compares a
 *   QR signature the same way.
 *
 * ── MY SWEEP MISSED THE EIGHT THAT MATTERED, FIRST TIME ─────────────────────
 *
 *   The first version excluded comparisons whose right-hand side began with a
 *   backtick, to skip literal string checks. Every cron route compares against
 *   `` `Bearer ${cronSecret}` `` — a template literal. So the sweep returned
 *   revalidate-cache and digital-id and NOT the eight routes that guard the
 *   money, and I would have reported a two-door finding.
 *
 *   Audit the instrument before believing the measurement, again, and this time
 *   the fault was hiding the important half rather than inventing a false one.
 *
 * ── AND THE TWO STRICT COPIES DISAGREED WITH EACH OTHER ─────────────────────
 *
 *   There were two hand-written `secretsMatch` functions and they were not the
 *   same function. api/auth/health pads both buffers and compares anyway, so a
 *   wrong LENGTH costs the same as a wrong byte; webhooks/africastalking
 *   returned false the moment the lengths differed. One contract, two
 *   statements of it, disagreeing about the thing the function exists to
 *   control. lib/secret-compare is the non-short-circuiting one.
 *
 * ── AND EIGHT COPIES OF THE CRON GATE, ALREADY DRIFTING ─────────────────────
 *
 *     the refusal is LOGGED        by gdpr-purge and release-escrow. The other
 *                                  six refused silently — an unauthorised
 *                                  attempt on the escrow trigger left no trace.
 *     the BODY                     three different shapes, one of them PLAIN
 *                                  TEXT where the others answered JSON.
 *     the HEADER NAME              "authorization" in six, "Authorization" in
 *                                  two. Harmless, and proof nobody was
 *                                  comparing these files.
 *     a REDUNDANT null check       in reconcile-paystack alone.
 *
 *   None of those was a defect on its own. Together they are why a rule stated
 *   eight times gets corrected in some of them.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   Nobody is extracting CRON_SECRET through a byte-by-byte comparison over the
 *   internet. That is not the argument and this file does not make it. The
 *   argument is that the idiom exists, the fix costs nothing, and eleven copies
 *   of a security check that differ from each other are how the next real
 *   difference goes unnoticed.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';
import { secretsMatch, bearerToken } from '@/lib/secret-compare';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

const CRON_DIR = 'src/app/api/cron';
const CRON_ROUTES = readdirSync(join(ROOT, CRON_DIR)).sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#659 — the comparison itself', () => {
    it('MATCHES A SECRET AND REFUSES EVERYTHING ELSE', () => {
        expect(secretsMatch('s3cret', 's3cret')).toBe(true);
        expect(secretsMatch('s3cret', 's3crey')).toBe(false);
        //   Length differences, which is the case timingSafeEqual THROWS on —
        //   and throwing is itself an oracle.
        expect(secretsMatch('s3cret', 's3cretx')).toBe(false);
        expect(secretsMatch('s3cretx', 's3cret')).toBe(false);
        expect(secretsMatch('', 's3cret')).toBe(false);
    });

    it('AND REFUSES WHEN EITHER SIDE IS MISSING', () => {
        /*
         *   The shape cron-secret-fail-closed was written for: with the
         *   variable unset, `` `Bearer ${cronSecret}` `` is the string
         *   "Bearer undefined", which anybody can send. An absent secret must
         *   never match anything, including an absent header.
         */
        expect(secretsMatch(null, 's3cret')).toBe(false);
        expect(secretsMatch(undefined, 's3cret')).toBe(false);
        expect(secretsMatch('s3cret', undefined)).toBe(false);
        expect(secretsMatch(null, null)).toBe(false);
        expect(secretsMatch(undefined, undefined)).toBe(false);
        expect(secretsMatch('undefined', undefined)).toBe(false);
    });

    it('AND DOES THE WORK EVEN WHEN THE LENGTHS DIFFER', async () => {
        /*
         *   THE PROPERTY THIS MODULE EXISTS FOR, and the one a return value
         *   cannot reveal: both answers are `false`, so a mutant that
         *   short-circuits on a length mismatch SURVIVED every assertion above.
         *
         *   It is the exact difference between the two hand-written copies this
         *   module replaced — api/auth/health padded and compared anyway,
         *   webhooks/africastalking returned false the moment the lengths
         *   differed — so leaving it unasserted would leave the thing the
         *   finding is about unguarded.
         *
         *   Asserted BEHAVIOURALLY rather than by reading the source: does the
         *   comparison actually run? A test that greps for the absence of an
         *   early `return false` is a check on the presence of a line, which is
         *   what #649's and #651's surviving mutants were both about.
         */
        jest.resetModules();
        const realCrypto = jest.requireActual('crypto') as typeof import('crypto');
        const calls: number[] = [];
        jest.doMock('crypto', () => ({
            ...realCrypto,
            timingSafeEqual: (a: Buffer, b: Buffer) => {
                calls.push(a.length);
                return realCrypto.timingSafeEqual(a, b);
            },
        }));

        const { secretsMatch: fresh } = await import('@/lib/secret-compare');

        expect(fresh('short', 'a-much-longer-secret')).toBe(false);
        //   Run once, over buffers padded to the longer of the two.
        expect(calls).toEqual(['a-much-longer-secret'.length]);

        jest.dontMock('crypto');
        jest.resetModules();
    });

    it('AND READS A BEARER TOKEN WITHOUT WIDENING WHAT IS ACCEPTED', () => {
        expect(bearerToken('Bearer abc')).toBe('abc');
        expect(bearerToken('Bearer ')).toBe('');
        //   Case-sensitive on the scheme, exactly as all eleven call sites were
        //   before this module existed. Accepting `bearer` would WIDEN what the
        //   cron endpoints take, and a caller sending it is refused today.
        expect(bearerToken('bearer abc')).toBeNull();
        expect(bearerToken('Token abc')).toBeNull();
        expect(bearerToken(null)).toBeNull();
        expect(bearerToken('')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#659 — and no door compares a secret with plain equality', () => {
    /**
     * The ratchet, and the reason this file is worth more than the eleven
     * edits: it is the thing that stops door twelve.
     *
     * COMMENT-STRIPPED. This file's own header quotes
     * `` `Bearer ${cronSecret}` `` and the routes' headers quote the code they
     * replaced — #645's note in the webhook still shows the `!==` it removed.
     * A sweep over raw text would find prose and call it a defect, which is the
     * mirror of the trap #651, #654 and #655 hit in the other direction.
     */
    const SECRETY = /secret|token|signature|authHeader|authorization/i;

    function looseCompares(rel: string): string[] {
        return code(rel).split('\n').flatMap((line, i) => {
            const m = /([^\s=!]+)\s*[!=]==\s*(.+)$/.exec(line);
            if (!m) return [];
            const [, lhs, rhs] = m;
            if (!SECRETY.test(lhs) && !SECRETY.test(rhs)) return [];
            if (/\.length|typeof|null|undefined/.test(line)) return [];
            return [`${rel}:${i + 1} ${line.trim().slice(0, 80)}`];
        });
    }

    it('NOT ONE OF THE EIGHT CRON ROUTES', () => {
        const offenders = CRON_ROUTES.flatMap((d) => looseCompares(`${CRON_DIR}/${d}/route.ts`));
        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('NOR THE CACHE REVALIDATOR, WHICH #645 NAMED AND LEFT', () => {
        expect({ offenders: looseCompares('src/app/api/revalidate-cache/route.ts') })
            .toEqual({ offenders: [] });
    });

    it('NOR THE WEBHOOK, THE HEALTH PROBE OR THE QR VERIFIER', () => {
        for (const f of [
            'src/app/api/webhooks/africastalking/route.ts',
            'src/app/api/auth/health/route.ts',
            'src/lib/digital-id.ts',
        ]) {
            expect({ [f]: looseCompares(f) }).toEqual({ [f]: [] });
        }
    });

    it('AND ALL FOUR OF THOSE ASK THE SHARED FUNCTION', () => {
        //   The other half: "no loose comparison" is also satisfied by deleting
        //   the check, which would be the defect rather than its repair.
        for (const f of [
            'src/app/api/revalidate-cache/route.ts',
            'src/app/api/webhooks/africastalking/route.ts',
            'src/app/api/auth/health/route.ts',
            'src/lib/digital-id.ts',
        ]) {
            expect(`${f}: ${code(f).includes('secretsMatch(')}`).toBe(`${f}: true`);
        }
    });

    it('AND THERE IS EXACTLY ONE IMPLEMENTATION OF IT', () => {
        /*
         *   There were two, and they disagreed. A second definition anywhere is
         *   the drift starting again — so the sweep is over all of src, not
         *   over the files this finding happened to touch.
         */
        const walk = (dir: string): string[] =>
            readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
                e.isDirectory()
                    ? (e.name === '__tests__' ? [] : walk(`${dir}/${e.name}`))
                    : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
                        ? [`${dir}/${e.name}`]
                        : []);

        const definers = walk('src').filter((f) =>
            /function secretsMatch\s*\(|const secretsMatch\s*=/.test(code(f)));

        expect(definers).toEqual(['src/lib/secret-compare.ts']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#659 — and the eight cron routes share one gate', () => {
    it('EVERY ONE OF THEM CALLS IT', () => {
        const missing = CRON_ROUTES.filter((d) =>
            !code(`${CRON_DIR}/${d}/route.ts`).includes('refuseUnauthorisedCron('));

        expect({ missing }).toEqual({ missing: [] });
        //   The sweep is over the directory, so a cron route added tomorrow is
        //   in it without this file being edited.
        expect(CRON_ROUTES.length).toBeGreaterThanOrEqual(8);
    });

    it('AND NONE OF THEM STILL READS THE SECRET ITSELF', () => {
        /*
         *   The half that makes the assertion above mean something. Calling the
         *   gate AND keeping a second hand-written check is how a rule ends up
         *   stated twice in one file — and the second copy is the one that
         *   stops being corrected.
         */
        const stillReading = CRON_ROUTES.filter((d) =>
            /process\.env\.CRON_SECRET/.test(code(`${CRON_DIR}/${d}/route.ts`)));

        expect({ stillReading }).toEqual({ stillReading: [] });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#659 — and the gate behaves as all eight did at their strictest', () => {
    const ORIGINAL = process.env.CRON_SECRET;

    const request = (auth?: string) => ({
        headers: { get: (k: string) => (k.toLowerCase() === 'authorization' && auth ? auth : null) },
    });

    const gate = async () => (await import('@/lib/cron-auth')).refuseUnauthorisedCron;

    beforeEach(() => { jest.resetModules(); });
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = ORIGINAL;
    });

    it('AN UNSET SECRET IS A 500 AND THE JOB DOES NOT RUN', async () => {
        //   cron-secret-fail-closed's finding, kept: `Bearer undefined` was a
        //   valid credential for payouts and for account deletion.
        delete process.env.CRON_SECRET;
        const refuse = await gate();

        const res = refuse(request('Bearer undefined') as any, 'a-job');
        expect(res?.status).toBe(500);
    });

    it('AND SO IS ONE WITH NO HEADER AT ALL', async () => {
        delete process.env.CRON_SECRET;
        const refuse = await gate();
        expect(refuse(request() as any, 'a-job')?.status).toBe(500);
    });

    it('A WRONG OR ABSENT HEADER IS A 401', async () => {
        process.env.CRON_SECRET = 'the-real-secret';
        const refuse = await gate();

        expect(refuse(request() as any, 'a-job')?.status).toBe(401);
        expect(refuse(request('Bearer wrong') as any, 'a-job')?.status).toBe(401);
        expect(refuse(request('the-real-secret') as any, 'a-job')?.status).toBe(401);
        //   The scheme is not optional and its case is not either.
        expect(refuse(request('bearer the-real-secret') as any, 'a-job')?.status).toBe(401);
    });

    it('AND THE RIGHT ONE IS LET THROUGH', async () => {
        //   THE positive control. A gate that refuses everything passes every
        //   assertion above and breaks every cron job in the platform.
        process.env.CRON_SECRET = 'the-real-secret';
        const refuse = await gate();

        expect(refuse(request('Bearer the-real-secret') as any, 'a-job')).toBeNull();
    });

    it('AND THE 401 SAYS THE SAME THING TO EVERY JOB', async () => {
        /*
         *   Three bodies across eight routes, one of them plain text. A caller
         *   parsing JSON got a parse error from process-email-queue instead of
         *   a reason.
         */
        process.env.CRON_SECRET = 'the-real-secret';
        const refuse = await gate();

        const res = refuse(request('Bearer wrong') as any, 'a-job')!;
        await expect(res.json()).resolves.toEqual({
            error: 'Unauthorized. Provide Authorization: Bearer <CRON_SECRET>',
        });
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: a cron route goes back to `!==`                     KILLED
 *     revalidate-cache goes back to `!==`                             KILLED
 *     digital-id goes back to `!==`                                   KILLED
 *     a second secretsMatch is defined in a route again               KILLED
 *     secretsMatch short-circuits on a length mismatch                KILLED
 *     an unset secret stops being a 500                               KILLED
 *     a wrong bearer token stops being a 401                          KILLED
 *     the gate refuses the CORRECT secret too                         KILLED
 *     bearerToken accepts a lowercase scheme                          KILLED
 *     a cron route keeps the gate and re-reads CRON_SECRET            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── ONE SURVIVED THE FIRST RUN, AND IT WAS THE POINT OF THE MODULE ──────────
 *
 *   "secretsMatch short-circuits on a length mismatch" survived, because both
 *   versions return `false` — the difference is only in how long they take, and
 *   a return value cannot show that. It is also the EXACT difference between
 *   the two hand-written copies this module replaced, so leaving it unasserted
 *   would have left the thing the finding is about unguarded.
 *
 *   Asserted behaviourally rather than by reading the source: crypto's
 *   timingSafeEqual is wrapped and the test asks whether the comparison
 *   actually ran, over buffers padded to the longer length. A test that grepped
 *   for the absence of an early `return false` would be a check on the presence
 *   of a line, which is what #649's and #651's surviving mutants were both
 *   about.
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The eleven doors were found by sweep and then read by hand, one file at a
 *   time. The existing ratchets were run before and after: cron-secret-fail-
 *   closed (unchanged, still green) and every-api-route-has-a-door, which
 *   FAILED on this change — correctly, because seven routes stopped mentioning
 *   CRON_SECRET on one commit. It was taught the new convention rather than
 *   loosened; `refuseUnauthorisedCron` is a control and is listed as one.
 */
