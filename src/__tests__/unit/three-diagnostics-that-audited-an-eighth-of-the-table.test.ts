/**
 * @jest-environment node
 */

/**
 *   #915 THREE DIAGNOSTICS AUDITED FIVE THOUSAND OF FORTY-ONE THOUSAND USERS
 *   AND PRINTED A TOTAL.
 *
 *   Found auditing src/scripts/, the last cluster of files no test had named.
 *   Five of the eleven scripts there were unreached; the other three of those
 *   five turned out clean, which is stated below rather than left as silence.
 *
 *   `db.collection(USERS).get()` with no `.limit()` does NOT read the table.
 *   supabase-db caps an unbounded query at DEFAULT_QUERY_LIMIT — 5,000 — and its
 *   own header names the size of the table it runs against: "a single page load
 *   against the 41,000-row users table". So each of these read about an eighth of
 *   the users and printed its counts as the answer:
 *
 *       audit-academy   "Total users with Academy registration: N"
 *                       "Total users who bypassed payment: N"
 *                       …and wrote scratch/academy_unpaid_report.json, the list
 *                       an operator would work through
 *       check-legacy    "Paid users: N" / "Legacy synced users: N"
 *       check-apps      sweeps ACADEMY_APPLICATIONS the same way
 *
 *   SupabaseQuerySnapshot exposes `.truncated` for exactly this and says why:
 *
 *       "A truncated result looks identical to a complete one, which is how a
 *        repair script reports success having processed a fraction of the table.
 *        Anything that sweeps a whole collection should either use `.all()` or
 *        check this."
 *
 *   `.all()` is the documented escape for "a repair sweep, a migration, a
 *   broadcast", and a diagnostic is the same shape — reading everything is the
 *   entire point. backfill_academy_plans was already fixed this way and
 *   maintenance-scripts-are-inside-the-gates asserts it reads 5,001 rather than
 *   5,000. These three missed the lesson.
 *
 * ── WHY THIS IS TESTED AND NOT JUST ASSERTED IN SOURCE ──────────────────────
 *
 *   All three ran their body at import and called `process.exit(0)` on the way
 *   out, so nothing could import one to see what it read — which is a good part
 *   of why the truncation went unnoticed. They export their function now and the
 *   exit lives behind `require.main === module`, the arrangement #328 gave
 *   firebase-schema-fix. A maintenance tool nobody can call is one nobody can
 *   test.
 *
 *   The fake reproduces the cap and is verified against real Postgres in
 *   __tests__/pg/fake-db-matches-postgres.test.ts, so the control below measures
 *   real behaviour rather than restating the fix.
 *
 * ── WHAT WAS CHECKED AND FOUND CLEAN ────────────────────────────────────────
 *
 *   auth-db-audit       pages properly — `adminAuth.listUsers(1000, pageToken)`
 *                       in a loop, then a per-document read by uid. No sweep.
 *   diag-coop-members   bypasses the adapter for PostgREST and queries named
 *                       users, so there is nothing to truncate.
 *   auth-purge-orphans  despite the name, writes nothing — 0 set/update/delete.
 *
 *   Recorded because "I looked at five and fixed three" is a more useful
 *   sentence than "I fixed three".
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.2 });

const SCRIPTS = {
    auditAcademy: 'src/scripts/audit-academy.ts',
    checkLegacy: 'src/scripts/check-legacy.ts',
    checkApps: 'src/scripts/check-apps.ts',
} as const;

/** A user row carrying an academy registration in the shape the scripts read. */
function academyUser(paymentStatus: string | undefined, extra: Record<string, unknown> = {}) {
    return {
        email: 'learner@example.com',
        serviceRegistrations: {
            academy: { status: 'approved', plan: 'standard', ...(paymentStatus ? { paymentStatus } : {}), ...extra },
        },
    };
}

describe('#915 — the cap is real in this harness (control)', () => {
    let handle: FakeDbHandle | undefined;

    afterEach(() => {
        handle = undefined;
        jest.resetModules();
    });

    it('A BARE .get() STOPS AT 5,000 — which is the defect', async () => {
        //   First and load-bearing. Every assertion below is "the script read
        //   5,001", and against a fake that never truncates all of them would
        //   pass whether or not `.all()` is there.
        const users: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) users[`u${i}`] = academyUser('completed');
        handle = installFakeDb({ users });

        const { supabaseDb } = await import('@/lib/supabase-db');
        const capped = await supabaseDb.collection('users').get();

        expect(capped.size).toBe(5000);
        expect(capped.docs.length).toBe(5000);
    }, 180_000);

    it('and .all() on the same store reads every row', async () => {
        const users: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) users[`u${i}`] = academyUser('completed');
        handle = installFakeDb({ users });

        const { supabaseDb } = await import('@/lib/supabase-db');
        const whole = await supabaseDb.collection('users').all().get();

        expect(whole.size).toBe(5001);
    }, 180_000);
});

describe('#915 — check-legacy counts every user, not the first 5,000', () => {
    afterEach(() => {
        jest.resetModules();
    });

    it('READS 5,001 AND COUNTS 5,001', async () => {
        const users: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) users[`u${i}`] = academyUser('completed');
        installFakeDb({ users });

        const { checkUsers } = await import('@/scripts/check-legacy');
        const result = await checkUsers();

        expect(result.read).toBe(5001);
        expect(result.paid).toBe(5001);
    }, 180_000);

    it('and it distinguishes what it is counting', async () => {
        //   Not just "a big number came back". The two tallies are different
        //   questions and a sweep that conflated them would pass the test above.
        installFakeDb({
            users: {
                paid1: academyUser('completed'),
                paid2: academyUser('completed', { syncedFromLegacy: true }),
                unpaid: academyUser('pending'),
                legacyOnly: academyUser(undefined, { syncedFromLegacy: true }),
                noAcademy: { email: 'nobody@example.com' },
            },
        });

        const { checkUsers } = await import('@/scripts/check-legacy');
        const result = await checkUsers();

        expect(result).toEqual({ read: 5, paid: 2, legacySynced: 2 });
    }, 60_000);
});

describe('#915 — audit-academy sweeps the whole table and writes a complete report', () => {
    const REPORT = join(ROOT, 'scratch/academy_unpaid_report.json');

    beforeEach(() => {
        if (existsSync(REPORT)) rmSync(REPORT);
    });

    afterEach(() => {
        if (existsSync(REPORT)) rmSync(REPORT);
        jest.resetModules();
    });

    it('FINDS THE BYPASSED USER BEYOND THE 5,000th ROW', () => {
        //   The sharpest form of the finding. 5,000 paid users and ONE unpaid,
        //   placed last: under the cap the report is empty and the operator is
        //   told nobody bypassed payment.
        const users: Record<string, any> = {};
        for (let i = 0; i < 5000; i++) users[`u${String(i).padStart(5, '0')}`] = academyUser('completed');
        users['zzz-last'] = academyUser('pending');

        return (async () => {
            installFakeDb({ users });

            const { runAudit } = await import('@/scripts/audit-academy');
            const result = await runAudit();

            expect(result.read).toBe(5001);
            expect(result.bypassed).toHaveLength(1);
            expect(result.bypassed[0]).toMatchObject({ id: 'zzz-last', paymentStatus: 'pending' });
        })();
    }, 180_000);

    it('and it writes the report even when scratch/ does not exist', async () => {
        //   writeFileSync throws ENOENT on a missing folder — AFTER the counts
        //   are printed, so the run looked like it worked and the report it
        //   exists to produce was gone. mkdirSync recursive, first.
        rmSync(join(ROOT, 'scratch'), { recursive: true, force: true });
        installFakeDb({ users: { u1: academyUser('pending') } });

        const { runAudit } = await import('@/scripts/audit-academy');
        await runAudit();

        expect(existsSync(REPORT)).toBe(true);
        const written = JSON.parse(readFileSync(REPORT, 'utf8'));
        expect(written).toHaveLength(1);
        expect(written[0].paymentStatus).toBe('pending');
    }, 60_000);

    it('reports a missing paymentStatus as "missing" rather than dropping it', async () => {
        //   A registration with no paymentStatus at all is the case most worth
        //   finding, and `|| 'missing'` is what stops it reading as a blank.
        installFakeDb({ users: { u1: academyUser(undefined) } });

        const { runAudit } = await import('@/scripts/audit-academy');
        const result = await runAudit();

        expect(result.bypassed).toHaveLength(1);
        expect(result.bypassed[0].paymentStatus).toBe('missing');
    }, 60_000);
});

describe('#915 — check-apps sweeps every application', () => {
    afterEach(() => {
        jest.resetModules();
    });

    it('READS 5,001 APPLICATIONS', async () => {
        const academy_applications: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) {
            academy_applications[`a${i}`] = { userId: `u${i}`, paymentStatus: 'pending' };
        }
        installFakeDb({ academy_applications, users: {} });

        const { checkApps } = await import('@/scripts/check-apps');
        const result = await checkApps();

        expect(result.read).toBe(5001);
    }, 180_000);

    it('and it flags an application paid where the user row is not', async () => {
        installFakeDb({
            academy_applications: {
                a1: { userId: 'u1', paymentStatus: 'completed' },
                a2: { userId: 'u2', paymentReference: 'PSK-123' },
                a3: { userId: 'u3', paymentStatus: 'completed' },
            },
            users: {
                u1: academyUser('completed'),
                u2: academyUser('pending'),
                u3: academyUser(undefined),
            },
        });

        const { checkApps } = await import('@/scripts/check-apps');
        const result = await checkApps();

        //   u1 agrees, u2 and u3 do not.
        expect(result).toEqual({ read: 3, legacyPaid: 2 });
    }, 60_000);
});

describe('#915 — the fix is in the code, and the shape that made it testable', () => {
    it('ALL THREE SWEEP WITH .all()', () => {
        for (const rel of Object.values(SCRIPTS)) {
            const src = code(rel);

            expect({ rel, all: src.includes('.all().get()') }).toEqual({ rel, all: true });
        }
    });

    it('AND NONE OF THEM STILL HAS A BARE COLLECTION SWEEP', () => {
        //   Comments stripped: each file's header quotes the old
        //   `db.collection(USERS).get()` to explain the finding, and an
        //   unstripped read finds that quotation and calls the fix absent. Fifth
        //   time in this audit — it is the single most repeated mistake in it.
        for (const rel of Object.values(SCRIPTS)) {
            const src = code(rel);

            expect({ rel, bare: /\.collection\([^)]*\)\.get\(\)/.test(src) }).toEqual({ rel, bare: false });
        }
    });

    it('POSITIVE CONTROL: the bare-sweep pattern matches what it is meant to', () => {
        expect(/\.collection\([^)]*\)\.get\(\)/.test('await db.collection(COLLECTIONS.USERS).get()')).toBe(true);
        expect(/\.collection\([^)]*\)\.get\(\)/.test('await db.collection(COLLECTIONS.USERS).all().get()')).toBe(false);
        //   A per-document read is not a sweep and must not be flagged.
        expect(/\.collection\([^)]*\)\.get\(\)/.test('await db.collection(USERS).doc(uid).get()')).toBe(false);
    });

    it('and each exports its function with the exit behind a main guard', () => {
        for (const rel of Object.values(SCRIPTS)) {
            const src = code(rel);

            expect({ rel, exported: /export async function/.test(src) }).toEqual({ rel, exported: true });
            expect({ rel, guarded: src.includes('require.main === module') }).toEqual({ rel, guarded: true });
            //   process.exit only inside that guard — a bare one at module scope
            //   would kill the test runner on import, which is the state they
            //   were in.
            const beforeGuard = src.slice(0, src.indexOf('require.main === module'));
            expect({ rel, exitAtTop: beforeGuard.includes('process.exit') }).toEqual({ rel, exitAtTop: false });
        }
    });

    it('each says how many rows it read', () => {
        //   A sweep that reports its own size cannot quietly become wrong again
        //   the day DEFAULT_QUERY_LIMIT changes.
        for (const rel of Object.values(SCRIPTS)) {
            expect({ rel, reports: /Read \$\{/.test(code(rel)) }).toEqual({ rel, reports: true });
        }
    });

    it('POSITIVE CONTROL: the stripper left real code behind', () => {
        //   Three `not`-shaped assertions above, all of which pass on an empty
        //   string.
        for (const rel of Object.values(SCRIPTS)) {
            const src = code(rel);
            expect({ rel, long: src.length > 400 }).toEqual({ rel, long: true });
            expect({ rel, reads: src.includes('COLLECTIONS.') }).toEqual({ rel, reads: true });
        }
    });
});

describe('#915 — the two that page correctly are left alone', () => {
    it('auth-db-audit pages through listUsers and reads by document id', () => {
        const src = code('src/scripts/auth-db-audit.ts');

        expect(src).toMatch(/listUsers\(1000,\s*nextPageToken\)/);
        expect(src).toMatch(/nextPageToken/);
        //   Its only collection read is per-document, which no cap applies to.
        expect(/\.collection\([^)]*\)\.get\(\)/.test(src)).toBe(false);
        expect(src).toMatch(/\.doc\(uid\)\.get\(\)/);
    });

    it('and diag-coop-members does not go through the adapter at all', () => {
        const src = code('src/scripts/diag-coop-members.ts');

        expect(src).toContain('/rest/v1/');
        expect(src).not.toContain('supabase-db');
        expect(/\.collection\([^)]*\)\.get\(\)/.test(src)).toBe(false);
    });
});
