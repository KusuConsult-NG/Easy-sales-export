/**
 * @jest-environment node
 */

/**
 *   #691 THE PUSH GATE ASKED WHETHER A DATABASE WAS DECLARED, NOT WHETHER ONE
 *   WAS THERE.
 *
 *   `.husky/pre-push` decided whether to run the money SQL like this:
 *
 *       if [ -n "$PG_URL" ]; then  …run the suite…  else  …warn…  fi
 *
 *   A URL IS A DECLARATION, NOT A SERVICE. src/lib/testing/pg-harness.ts spends
 *   a page on precisely that, having been caught by it twice — `.env.staging`
 *   carrying Supabase variables with EMPTY values, and lib/supabase.ts degrading
 *   a missing URL to a placeholder — and it added assertRestReachable for the
 *   PostgREST half. The hook made the identical mistake for the POSTGRES half,
 *   including the third form the harness names by name: a stale
 *   `.env.development.local` left behind by a stack that is no longer up.
 *
 *   THE COST IS MEASURED, NOT SUPPOSED. A push during this audit ran against a
 *   database whose container had been reclaimed, and the hook answered:
 *
 *       ❌ Database tests failed. Fix them before pushing — CI runs this same
 *          suite.
 *
 *   That sentence points at the money SQL — locks, wallet debits, claim
 *   transitions. The money SQL was fine; nothing was listening on the port. The
 *   reader goes looking in the wrong place, and the reader who has seen it twice
 *   starts passing `--no-verify`, which is how a gate stops being one. #672
 *   added this suite to the hook precisely so a red money run could not be
 *   missed; a gate people route around protects nothing.
 *
 *   THE PROBE IS A TCP CONNECT. No `psql`, no `pg_isready`, no driver — a probe
 *   with its own dependencies is a second thing that can be missing from a
 *   contributor's laptop, which is the failure it exists to report.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'child_process';
import { createServer, type Server } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const PROBE = join(ROOT, 'scripts', 'pg-reachable.js');
const HOOK = readFileSync(join(ROOT, '.husky', 'pre-push'), 'utf8');

/** The probe's exit code for a URL. */
function probe(url: string): number {
    try {
        execFileSync(process.execPath, [PROBE, url], { stdio: 'ignore', timeout: 15000 });
        return 0;
    } catch (error: any) {
        return typeof error?.status === 'number' ? error.status : 1;
    }
}

/** A socket that accepts connections, so "something answered" is real. */
async function listening(): Promise<{ url: string; close: () => void }> {
    const server: Server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    return {
        url: `postgresql://postgres@127.0.0.1:${port}/app`,
        close: () => server.close(),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#691 — the probe answers the question the hook actually needs', () => {
    it('SAYS YES WHEN SOMETHING IS LISTENING', async () => {
        /*
         *   THE positive control, and it has to come first: a probe that
         *   answered "no" to everything would satisfy every other assertion
         *   here and silently switch the money SQL off for everybody.
         */
        const server = await listening();
        try {
            expect(probe(server.url)).toBe(0);
        } finally {
            server.close();
        }
    });

    it('AND NO WHEN THE PORT IS DEAD — the reclaimed container', async () => {
        //   The case that cost the time: a URL left in
        //   .env.development.local by a stack that is gone.
        const server = await listening();
        const url = server.url;
        server.close();
        //   Same URL, nothing behind it now.
        expect(probe(url)).toBe(1);
    });

    it('AND NO FOR A URL IT CANNOT EVEN PARSE', () => {
        expect(probe('not-a-url')).toBe(1);
        expect(probe('')).toBe(1);
    });

    it('AND IT READS BOTH SPELLINGS THIS REPOSITORY USES', async () => {
        /*
         *   `postgres://` and `postgresql://` both appear in this repo's own
         *   scripts and documentation — local-postgres.sh prints the first,
         *   .env.development.local carries the second. A probe that understood
         *   one would report the other as unreachable and turn the suite off.
         */
        const server = await listening();
        try {
            const port = new URL(server.url.replace('postgresql://', 'http://')).port;
            expect(probe(`postgres://postgres@127.0.0.1:${port}/app`)).toBe(0);
            expect(probe(`postgresql://postgres@127.0.0.1:${port}/app`)).toBe(0);
        } finally {
            server.close();
        }
    });

    it('AND NEEDS NOTHING INSTALLED TO ANSWER', () => {
        //   The reason it is a TCP connect. psql and pg_isready are not on
        //   every machine, and a probe that needs one reports "no database"
        //   for "no client tools" — the same confusion one level down.
        /*
         *   READ AS CODE, NOT AS PROSE. The first version of this asserted over
         *   the raw file and failed on the probe's OWN COMMENT, which explains
         *   why it does not use pg_isready. That is this audit's recorded
         *   comment-stripping trap, met again — and the recorded cure is the
         *   one applied: strip first, then assert.
         */
        const src = stripComments(readFileSync(PROBE, 'utf8'), { label: 'scripts/pg-reachable.js' });
        expect(src).toContain("require('net')");
        expect(src).not.toMatch(/pg_isready|execSync|child_process|require\('pg'\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#691 — and the hook tells the two apart', () => {
    it('THE DEFECT: it no longer runs the suite on a merely DECLARED database', () => {
        //   `if [ -n "$PG_URL" ]` was the whole of the old decision.
        expect(HOOK).toContain('node scripts/pg-reachable.js');
        expect(HOOK).not.toMatch(/if \[ -n "\$PG_URL" \]; then\s*\n\s*echo "🗄/);
    });

    it('AND AN UNREACHABLE DATABASE IS A WARNING, NOT A FAILED SUITE', () => {
        /*
         *   The distinction that matters. "Nothing answered" must not be
         *   reported in the words reserved for "the money SQL is broken", and
         *   it must not fail the push — #672's own argument, that a gate which
         *   fails for a missing optional dependency gets bypassed.
         */
        const unreachable = HOOK.slice(
            HOOK.indexOf('elif ! node scripts/pg-reachable.js'),
            HOOK.indexOf('else', HOOK.indexOf('elif ! node scripts/pg-reachable.js')),
        );
        expect(unreachable).toContain('nothing answered');
        expect(unreachable).toContain('NOT checked');
        expect(unreachable).not.toContain('exit 1');
        //   …and it names both ways out, because the reader has to pick one.
        expect(unreachable).toContain('local-stack/up.sh');
        expect(unreachable).toContain('.env.development.local');
    });

    it('AND A REAL FAILURE STILL STOPS THE PUSH, AND SAYS WHY IT IS REAL', () => {
        /*
         *   The control. Turning every database problem into a warning would
         *   satisfy the line above and undo #672 — seven consecutive pushes
         *   went to main with a red money suite before that finding.
         */
        const ran = HOOK.slice(HOOK.indexOf('🗄  Running the database suite'));
        expect(ran).toContain('npm run test:pg');
        expect(ran).toContain('exit 1');
        //   And the message distinguishes itself from the warning above it.
        expect(ran).toContain('A database ANSWERED');
    });

    it('AND THE UNIT SUITE STILL GATES THE PUSH UNCONDITIONALLY', () => {
        //   Nothing about this finding touches the half that always runs.
        const unit = HOOK.slice(0, HOOK.indexOf('PG_URL="$LOCAL_PG_URL"'));
        expect(unit).toContain('npm run test');
        expect(unit).toContain('exit 1');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the hook runs the suite on a declared URL again     KILLED
 *     the probe reports everything unreachable                        KILLED
 *     the probe reports everything reachable                          KILLED
 *     the probe mangles one of the two URL spellings               (withdrawn)
 *     an unreachable database fails the push instead of warning       KILLED
 *     a real database failure becomes a warning (undoing #672)        KILLED
 *     the warning stops naming how to fix it                          KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   THE WITHDRAWN ONE IS WORTH THE PARAGRAPH. The probe originally rewrote the
 *   scheme to `http://` before parsing, and a mutant narrowing that rewrite to
 *   one spelling SURVIVED. Checked rather than explained away: Node's URL
 *   parses `postgres://`, `postgresql://` and `zzz://` to the same hostname and
 *   port, so the rewrite was doing nothing and no mutant of that line can ever
 *   die.
 *
 *   The code came out rather than the mutant being excused. That is the useful
 *   half — a surviving mutant said a line was inert, and it was — and the test
 *   for both spellings stays, because it now measures the real property instead
 *   of a rewrite that was never load-bearing.
 */
