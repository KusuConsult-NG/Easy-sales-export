/**
 * @jest-environment node
 */

/**
 *   #296 A REFUSAL RENDERED AS A CLEAN BILL OF HEALTH.
 *
 *        /api/admin/orphaned-users finds accounts that exist in Firebase Auth
 *        with no Firestore profile — people who can sign in and have no
 *        record. It answers a caller without the role with
 *        `{ error: 'Unauthorized' }` and a 403, and any fault with `{ error }`
 *        and a 500. THERE IS NO `success` FIELD, so `response.ok` is the only
 *        signal, and none of the screen's three handlers looked at it.
 *
 *            const data = await response.json();
 *            setOrphanedUsers(data.users || []);
 *            setScan({ scanned: data.scanned ?? 0,
 *                      complete: data.complete !== false });
 *
 *        On a 403 that is an empty list and `complete: true` — because
 *        `undefined !== false` — so the screen printed:
 *
 *            "No orphaned users among all 0 Auth accounts"
 *
 *        An admin whose session had expired, or who lacked the role, was told
 *        the platform was healthy.
 *
 *        THIS SCREEN HAS SAID THAT BEFORE. Its own header records the last
 *        time: a scan of the first 1,000 of 41,105 Auth accounts, reported as
 *        the total. Same sentence, different door — which is exactly why the
 *        empty-state panel is now suppressed while an error is showing rather
 *        than being re-worded again.
 *
 *        AND THE REPAIRS WERE WORSE.
 *
 *        repairAll rendered the error body as Repair Results — "Total:
 *        undefined, Repaired: undefined" inside a green panel — then refreshed
 *        the list, which came back empty for the same reason, so a repair that
 *        never ran looked complete.
 *
 *        repairSingle called `await response.json()` and discarded it
 *        entirely, then refreshed. Identical outcome.
 *
 *        A throw left the previous list on screen with no message, so a failed
 *        rescan after a repair looked like a successful one.
 *
 * A CORRECTION TO THE PREVIOUS COMMIT'S NUMBERS
 * ---------------------------------------------
 * The sweep pinned "D4 — a fetch response never checked for ok or status" at
 * 54. Working through it, most of those are not defects: the handler ignores
 * `res.ok` but gates on `data.success`, which those endpoints do return, so a
 * non-2xx cannot be mistaken for data. The cooperative Paystack callback and
 * the digital-ID QR scanner both read that way and both fail CLOSED.
 *
 * Tightened to "no status check AND no success/error gate either", the real
 * count is FOUR — the three here, and one more in the member withdrawals page
 * where a hiccup on /api/auth/session returns early and shows an empty list
 * with no message. That last one is a redundant client-side check in front of
 * a server-scoped action, so it is noted rather than fixed.
 *
 * D4 stays pinned at 54 as a ceiling because the detector is still useful for
 * catching NEW unchecked fetches; what changed is my estimate of how many of
 * the existing ones matter.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const PAGE = 'src/app/admin/orphaned-users/page.tsx';
const ROUTE = 'src/app/api/admin/orphaned-users/route.ts';

function raw(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(rel: string): string {
    return raw(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const src = codeOnly(PAGE);

function handler(name: string): string {
    const start = src.indexOf(`const ${name} = async`);
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 10);
    const end = rest.search(/\n    (const \w+ = async|return \()/);
    return rest.slice(0, end > 0 ? end : 1600);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#296 — the endpoint gives no success flag, so the status is the signal', () => {
    it('IT REFUSES WITH A STATUS AND AN error, AND NOTHING ELSE', () => {
        // The premise of the whole finding. If this route ever grows a
        // `success` field the screen could gate on that instead — and this
        // test is where that would be noticed.
        const route = codeOnly(ROUTE);

        expect(route).toMatch(/\{ error: 'Unauthorized' \}, \{ status: 403 \}/);
        expect(route).toMatch(/status: 500/);
        expect(route).not.toMatch(/success:\s*true/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#296 — all three handlers read the status', () => {
    for (const name of ['detectOrphaned', 'repairAll', 'repairSingle']) {
        it(`${name} GOES THROUGH THE ONE READER THAT CHECKS response.ok`, () => {
            const body = handler(name);

            expect(body).toContain('readJson(');
            // The inline form all three carried.
            expect(body).not.toMatch(/const data = await response\.json\(\)/);
        });

        it(`${name} STOPS on a refusal instead of continuing`, () => {
            const body = handler(name);

            expect(body).toMatch(/if \(!result\.ok\)/);
            expect(body).toMatch(/setError\(result\.reason\)/);
            expect(body).toMatch(/return;/);
        });

        it(`${name} says something when it throws, rather than nothing`, () => {
            // A throw used to log and leave the screen exactly as it was.
            const body = handler(name);

            expect(body).toMatch(/catch \(err\)/);
            expect(body).toMatch(/setError\(/);
        });
    }

    it('THE READER IS THE ONLY PLACE response.ok IS DECIDED', () => {
        // One expression, three callers — the shape of the defect was three
        // copies of a read, each missing the same check.
        expect((src.match(/response\.ok/g) ?? []).length).toBe(1);
        // Three CALLS. The definition is `const readJson = async (response…)`,
        // which carries no `readJson(` — the first version of this counted a
        // definition that does not match its own call pattern.
        expect((src.match(/readJson\(/g) ?? []).length).toBe(3);
        expect(src).toContain('const readJson = async (response: Response)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#296 — a failed scan does not overwrite what is on screen', () => {
    it('THE LIST AND THE SCAN SUMMARY ARE LEFT ALONE', () => {
        // The precise defect: `data.users || []` and `data.scanned ?? 0`
        // replaced real findings with zeroes, and `data.complete !== false`
        // turned undefined into "complete".
        const body = handler('detectOrphaned');
        const failureBranch = body.slice(body.indexOf('if (!result.ok)'), body.indexOf('const data = result.data'));

        expect(failureBranch).not.toContain('setOrphanedUsers');
        expect(failureBranch).not.toContain('setScan');
    });

    it('AND THE "no orphaned users" PANEL IS SUPPRESSED WHILE AN ERROR SHOWS', () => {
        // Re-wording that sentence would not have helped: the problem is that
        // it was shown at all after a failed look.
        expect(src).toMatch(/orphanedUsers\.length === 0 && !loading && !error/);
    });

    it('and the failure is announced', () => {
        expect(src).toMatch(/\{error && \(/);
        expect(src).toContain('role="alert"');
        expect(src).toContain('The scan did not run');
    });

    it('and a successful scan still fills the list, which is the point', () => {
        // Vacuity guard: a handler that never set anything would satisfy every
        // assertion above.
        const body = handler('detectOrphaned');

        expect(body).toContain('setOrphanedUsers(data.users || [])');
        expect(body).toMatch(/setScan\(\{ scanned: data\.scanned/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#296 — a repair reports what happened', () => {
    it('REPAIR RESULTS ARE ONLY SHOWN FOR A SUCCESSFUL REPAIR', () => {
        // It used to `setResults(data)` unconditionally, so `{ error: ... }`
        // was rendered in the green Repair Results panel as
        // "Total: undefined, Repaired: undefined".
        const body = handler('repairAll');

        expect(body).toContain('setResults(result.data)');
        expect(body).not.toMatch(/setResults\(data\)/);
    });

    it('and repairSingle no longer throws its answer away', () => {
        // Was: `await response.json();` with the value unused, then a refresh.
        const body = handler('repairSingle');

        expect(body).not.toMatch(/await response\.json\(\);\s*$/m);
        expect(body).toMatch(/if \(!result\.ok\)/);
    });
});
