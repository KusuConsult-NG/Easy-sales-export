/**
 * @jest-environment node
 */

/**
 *   #329 THE MAINTENANCE SCRIPTS WROTE IMMEDIATELY, COVERED A FRACTION OF WHAT
 *        THEY CLAIMED, AND TWO OF THEM DESTROYED OR GRANTED ON A DEFAULT NOBODY
 *        CHOSE.
 *
 *        #328 put scripts/ back inside the typechecker and eslint. That is what
 *        a compiler can see. This is what it cannot:
 *
 *        A RE-RUN OF `npm run seed:cooperative` ZEROED A LIVE COOPERATIVE.
 *            Its first write was `set(cooperativeData)` with no merge, carrying
 *            memberCount: 0, totalSavings: 0, totalLoans: 0. A non-merging
 *            set() REPLACES the document, so a cooperative that already had
 *            members and savings had all three written back to zero — and the
 *            script printed "✅ Cooperative created successfully". It then reset
 *            the member's balance to ₦10,000 while incrementing the
 *            cooperative's totals unconditionally, so the same person was
 *            counted and credited twice.
 *
 *        THE ACADEMY BACKFILL GRANTED THE ₦270,000 TIER BY DEFAULT.
 *            `if (academy && !academy.plan) update({ ...plan: "elite" })`.
 *            elite is the most expensive plan this platform sells and it opens
 *            every course tier. The platform's own answer for "nothing usable
 *            was recorded" is DEFAULT_ACADEMY_PLAN — "foundation", and its
 *            comment says "The cheapest, deliberately."
 *
 *        THE ORPHAN REPAIR HELD A REAL UID BESIDE PLACEHOLDER IDENTITY.
 *            uid 'Rc0mYvgCBCcgCQf0FzfMRC73Mvz1' with email 'user@example.com',
 *            fullName 'User Name' and verified: true, written with merge. The
 *            "REPLACE WITH ACTUAL" comments were the only thing standing
 *            between a run and a real person's email being overwritten.
 *
 *        FOUR WHOLE-COLLECTION READS WERE CAPPED AT 5,000 AND REPORTED AS
 *        COMPLETE. repair-schemas, mark-unpaid, backfill_versions (twice) and
 *        backfill_academy_plans each used a bare .get(). backfill_versions even
 *        printed the truncated number as "total".
 *
 *        THREE ENDED IN `.catch(console.error)` — a failed run exited 0, so any
 *        wrapper saw success. One of those, audit-data-integrity, wrote its
 *        report into ./artifacts/, a directory that does not exist: it did the
 *        whole audit, threw ENOENT, lost the report and reported success.
 *
 *        Three scripts already had the right shape — report-only unless
 *        --apply. That convention is now one module, scripts/_maintenance-guard.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { DEFAULT_ACADEMY_PLAN } from '@/lib/academy-plan';
import { ACADEMY_CONFIG } from '@/lib/constants';
import {
    isApply,
    targetHost,
    modeBanner,
    runScript,
} from '../../../scripts/_maintenance-guard';

const ROOT = process.cwd();

function read(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

/** Every maintenance script that writes to the database. */
const WRITING_SCRIPTS = [
    'scripts/backfill-academy-enrolled-count.ts',
    'scripts/backfill-export-funding-goals.ts',
    'scripts/backfill-fixed-savings-ledger.ts',
    'scripts/firebase-schema-fix.ts',
    'scripts/repair-savings-balance.ts',
    'scripts/repair-schemas.ts',
    'scripts/seed-cooperative.ts',
    'src/scripts/backfill_academy_plans.ts',
    'src/scripts/backfill_versions.ts',
    'src/scripts/mark-unpaid.ts',
    'src/scripts/repair-orphaned-user.ts',
];

// Every script prints its target host before doing anything, and refuses when
// it cannot name one — see targetHost. That refusal is itself tested below; the
// scripts under execution need a target supplied, as an operator would.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';

const ORIGINAL_ARGV = process.argv;
function withArgv<T>(argv: string[], fn: () => T): T {
    process.argv = ['node', 'script.ts', ...argv];
    try {
        return fn();
    } finally {
        process.argv = ORIGINAL_ARGV;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#329 — the shared guard', () => {
    it('isApply reads the flag from the argv it is given', () => {
        expect(isApply(['node', 's.ts'])).toBe(false);
        expect(isApply(['node', 's.ts', '--apply'])).toBe(true);
        expect(isApply(['node', 's.ts', 'you@example.com', '--apply'])).toBe(true);
    });

    it('and defaults to REPORT ONLY, which is the whole point', () => {
        expect(isApply([])).toBe(false);
    });

    it('a near-miss flag does not enable writes', () => {
        // --applyAll, --apply-all and APPLY=1 are the shapes somebody reaches
        // for from memory. None of them writes.
        for (const near of ['--applyAll', '--apply-all', 'apply', 'APPLY=1', '-a']) {
            expect({ near, apply: isApply(['node', 's.ts', near]) })
                .toEqual({ near, apply: false });
        }
    });

    it('targetHost names the SUPABASE host — the connection the writes travel', () => {
        expect(targetHost('https://abcdef.supabase.co')).toBe('abcdef.supabase.co');
        expect(targetHost('http://localhost:54321')).toBe('localhost');
    });

    it('AND REFUSES when the target is unknown, rather than proceeding', () => {
        // #304's lesson: a check that cannot be answered must stop the script.
        // `targetHost(undefined)` would fall back to the default parameter —
        // the env var — so the variable itself has to be removed to ask the
        // real question.
        const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        try {
            expect(() => targetHost()).toThrow(/refusing to run without knowing the target/i);
        } finally {
            process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
        }
        expect(() => targetHost('')).toThrow(/refusing to run/i);
    });

    it('the banner states the target and the mode', () => {
        const banner = modeBanner('Thing', false, 'db.example.com');
        expect(banner).toContain('db.example.com');
        expect(banner).toContain('report only');
        expect(modeBanner('Thing', true, 'db.example.com')).toContain('APPLY');
    });

    /**
     * THE EXIT CODE, EXECUTED.
     *
     * This is the one guarantee the whole finding rests on — a failed run must
     * not report success — and mutation testing found nothing was checking it:
     * changing runScript's `process.exit(1)` to `process.exit(0)` left all 37
     * tests passing. The scripts each ended in `.catch(console.error)` for
     * exactly this reason, and it went unnoticed for the same one.
     */
    describe('runScript decides the exit code', () => {
        let exited: number[];
        let exitSpy: any;
        let errSpy: any;
        let logSpy: any;

        beforeEach(() => {
            exited = [];
            exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
                exited.push(code ?? 0);
                return undefined as never;
            }) as any);
            errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        });

        afterEach(() => {
            exitSpy.mockRestore();
            errSpy.mockRestore();
            logSpy.mockRestore();
        });

        it('EXITS 1 WHEN THE WORK THREW', async () => {
            runScript('Thing', async () => { throw new Error('supabase down'); });
            await new Promise((r) => setImmediate(r));

            expect(exited).toEqual([1]);
            expect(errSpy).toHaveBeenCalledWith(
                expect.stringContaining('FAILED'),
                expect.any(Error),
            );
        });

        it('exits 0 when it succeeded', async () => {
            runScript('Thing', async () => 'fine');
            await new Promise((r) => setImmediate(r));

            expect(exited).toEqual([0]);
        });

        it('and a rejection with a non-Error value still exits 1', async () => {
            runScript('Thing', async () => { throw 'a string'; });
            await new Promise((r) => setImmediate(r));

            expect(exited).toEqual([1]);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#329 — the cooperative seed cannot zero a live cooperative', () => {
    let store: FakeDbHandle;
    let script: typeof import('../../../scripts/seed-cooperative');

    beforeEach(async () => {
        jest.clearAllMocks();
        script = await import('../../../scripts/seed-cooperative');
    });

    afterEach(() => { process.argv = ORIGINAL_ARGV; });

    const LIVE = {
        'coop-ezichi-farmers': {
            id: 'coop-ezichi-farmers',
            name: 'Ezichi Farmers Cooperative',
            memberCount: 47,
            totalSavings: 3_400_000,
            totalLoans: 900_000,
        },
    };

    it('LEAVES memberCount, totalSavings AND totalLoans ALONE on a re-run', async () => {
        store = installFakeDb({ cooperatives: LIVE });

        await withArgv(['--apply'], () => script.seedCooperative());

        const coop = store.get('cooperatives', 'coop-ezichi-farmers');
        expect({
            memberCount: coop?.memberCount,
            totalSavings: coop?.totalSavings,
            totalLoans: coop?.totalLoans,
        }).toEqual({ memberCount: 47, totalSavings: 3_400_000, totalLoans: 900_000 });
    });

    it('creates the cooperative when it genuinely does not exist', async () => {
        store = installFakeDb({});

        await withArgv(['--apply'], () => script.seedCooperative());

        const coop = store.get('cooperatives', 'coop-ezichi-farmers');
        expect(coop?.name).toBe('Ezichi Farmers Cooperative');
        expect(coop?.memberCount).toBe(0);
        expect(coop?.totalSavings).toBe(0);
    });

    /**
     * An assertion about the CALL, not about the resulting state — deliberately.
     *
     * That create only runs on the branch where the document is known not to
     * exist, and on a missing document a merging set() and a replacing one
     * produce identical state. So no test of the store can tell them apart, and
     * mutation testing duly found that deleting `{ merge: true }` from that
     * line broke nothing.
     *
     * The merge is still right, for the gap between the get() and the set():
     * `runTransaction` on this adapter takes NO LOCK, so a cooperative created
     * by anything else in that window would be replaced — the same zeroing this
     * whole finding is about, through a narrower door. Pinning the argument is
     * the only way to hold it.
     */
    it('and creates it WITH merge, so a concurrent create is not replaced', async () => {
        installFakeDb({});

        // The merge flag does not travel as an argument — firestore-mock-db.js
        // publishes it on globalThis.__firestoreAccess immediately before
        // calling the recorder, because several suites read the write payload
        // as `call[call.length - 1]`. So it is read from the descriptor, which
        // is the same value the fake itself acts on.
        const merges: { name: unknown; merge: unknown }[] = [];
        const inner = (global.mockFirestoreSet as any).getMockImplementation();
        (global.mockFirestoreSet as any).mockImplementation((...args: any[]) => {
            const payload = args[args.length - 1];
            merges.push({
                name: payload?.name,
                merge: (globalThis as any).__firestoreAccess?.merge,
            });
            return inner?.(...args);
        });

        await withArgv(['--apply'], () => script.seedCooperative());

        const create = merges.find((m) => m.name === 'Ezichi Farmers Cooperative');
        expect(create).toEqual({ name: 'Ezichi Farmers Cooperative', merge: true });
    });

    it('WRITES NOTHING AT ALL without --apply', async () => {
        store = installFakeDb({});

        // withArgv, because passing `undefined` explicitly still fires the
        // default parameter — which reads process.argv, and under jest that is
        // the test file's own path.
        await withArgv([], () => script.seedCooperative(undefined, false));

        expect(store.get('cooperatives', 'coop-ezichi-farmers')).toBeUndefined();
        expect(global.mockFirestoreSet).not.toHaveBeenCalled();
        expect(global.mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('does not re-credit or re-count a member who is already in', async () => {
        store = installFakeDb({
            cooperatives: LIVE,
            users: { u1: { email: 'member@example.com' } },
            'cooperatives/coop-ezichi-farmers/members': { u1: { userId: 'u1', balance: 250_000 } },
        });

        await withArgv(['member@example.com', '--apply'], () => script.seedCooperative());

        // The balance the member actually has, not ₦10,000 again.
        expect(store.get('cooperatives/coop-ezichi-farmers/members', 'u1')?.balance).toBe(250_000);
        // And the cooperative's counters were not incremented a second time.
        const coop = store.get('cooperatives', 'coop-ezichi-farmers');
        expect(coop?.memberCount).toBe(47);
        expect(coop?.totalSavings).toBe(3_400_000);
    });

    it('joins a genuinely new member with the initial savings', async () => {
        store = installFakeDb({
            cooperatives: LIVE,
            users: { u2: { email: 'new@example.com' } },
        });

        await withArgv(['new@example.com', '--apply'], () => script.seedCooperative());

        expect(store.get('cooperatives/coop-ezichi-farmers/members', 'u2')?.balance).toBe(10_000);
        expect(store.get('users', 'u2')?.cooperativeId).toBe('coop-ezichi-farmers');
    });

    it('THROWS when the email matches nobody, instead of reporting completion', async () => {
        // Both early returns used to fall through to "✨ Seed complete!" and
        // exit 0.
        installFakeDb({ cooperatives: LIVE });

        await expect(
            withArgv(['nobody@example.com', '--apply'], () => script.seedCooperative()),
        ).rejects.toThrow(/No user found/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#329 — the academy backfill grants the cheapest plan, not the dearest', () => {
    let store: FakeDbHandle;
    let script: typeof import('../../../src/scripts/backfill_academy_plans');

    beforeEach(async () => {
        jest.clearAllMocks();
        script = await import('../../../src/scripts/backfill_academy_plans');
    });

    afterEach(() => { process.argv = ORIGINAL_ARGV; });

    const approved = (plan?: string) => ({
        serviceRegistrations: { academy: { status: 'approved', ...(plan ? { plan } : {}) } },
    });

    it('WRITES "foundation", NOT "elite"', async () => {
        store = installFakeDb({ users: { u1: approved() } });

        await withArgv(['--apply'], () => script.backfillAcademyPlans());

        const written = store.get('users', 'u1')?.serviceRegistrations.academy.plan;
        expect(written).toBe(DEFAULT_ACADEMY_PLAN);
        expect(written).toBe('foundation');
        expect(written).not.toBe('elite');
    });

    it('and "foundation" is the cheapest plan sold, which is why it is the default', () => {
        // Couples the claim to the price list rather than restating a string.
        const fees = Object.values(ACADEMY_CONFIG.plans).map((p) => p.fee);
        expect(ACADEMY_CONFIG.plans[DEFAULT_ACADEMY_PLAN].fee).toBe(Math.min(...fees));
        // The value the script used to write is the most expensive one.
        expect(ACADEMY_CONFIG.plans.elite.fee).toBe(Math.max(...fees));
    });

    it('leaves a learner who already has a plan alone', async () => {
        store = installFakeDb({ users: { u1: approved('elite') } });

        const changed = await withArgv(['--apply'], () => script.backfillAcademyPlans());

        expect(changed).toEqual([]);
        expect(store.get('users', 'u1')?.serviceRegistrations.academy.plan).toBe('elite');
    });

    it('writes nothing without --apply', async () => {
        store = installFakeDb({ users: { u1: approved() } });

        const would = await script.backfillAcademyPlans();

        expect(would).toEqual(['u1']);
        expect(store.get('users', 'u1')?.serviceRegistrations.academy.plan).toBeUndefined();
    });

    it('READS EVERY MATCHING USER — 5,001, not the first 5,000', async () => {
        const users: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) users[`u${i}`] = approved();
        installFakeDb({ users });

        const would = await script.backfillAcademyPlans();

        expect(would.length).toBe(5001);
    }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#329 — the orphan repair refuses placeholders', () => {
    let script: typeof import('../../../src/scripts/repair-orphaned-user');

    beforeEach(async () => {
        jest.clearAllMocks();
        script = await import('../../../src/scripts/repair-orphaned-user');
    });

    afterEach(() => { process.argv = ORIGINAL_ARGV; });

    it.each([
        ['user@example.com', 'Real Name'],
        ['real@example.com', 'User Name'],
        ['REPLACE WITH ACTUAL EMAIL', 'Real Name'],
    ])('refuses email=%s name=%s', (email, fullName) => {
        expect(() => script.validateOrphanRepairInput({ uid: 'u1', email, fullName }))
            .toThrow(/placeholder/i);
    });

    it('refuses when a field is missing entirely', () => {
        expect(() => script.validateOrphanRepairInput({ uid: 'u1', email: 'a@b.c' }))
            .toThrow(/all required/i);
        expect(() => script.validateOrphanRepairInput({}))
            .toThrow(/all required/i);
    });

    it('accepts real values and defaults the role to general_user', () => {
        expect(script.validateOrphanRepairInput({
            uid: 'Rc0mYvgCBCcgCQf0FzfMRC73Mvz1',
            email: 'ada@example.org',
            fullName: 'Ada Nwosu',
        })).toEqual({
            uid: 'Rc0mYvgCBCcgCQf0FzfMRC73Mvz1',
            email: 'ada@example.org',
            fullName: 'Ada Nwosu',
            roles: ['general_user'],
        });
    });

    it('REFUSES TO MERGE OVER A PROFILE THAT ALREADY EXISTS', async () => {
        // The merge-write is exactly how a real email would have been replaced
        // by "user@example.com".
        const store = installFakeDb({ users: { u1: { email: 'real@person.ng', fullName: 'Real Person' } } });

        await expect(withArgv(['--apply'], () => script.repairOrphanedUser({
            uid: 'u1', email: 'ada@example.org', fullName: 'Ada Nwosu',
        }))).rejects.toThrow(/already has a profile/);

        expect(store.get('users', 'u1')?.email).toBe('real@person.ng');
    });

    it('creates the missing profile, and DOES NOT grant verification', async () => {
        const store = installFakeDb({});

        await withArgv(['--apply'], () => script.repairOrphanedUser({
            uid: 'u1', email: 'ada@example.org', fullName: 'Ada Nwosu',
        }));

        const created = store.get('users', 'u1');
        expect(created?.email).toBe('ada@example.org');
        // `verified: true` was written unconditionally, by a script that cannot
        // verify anybody.
        expect(created).not.toHaveProperty('verified');
    });

    it('writes nothing without --apply', async () => {
        const store = installFakeDb({});

        const result = await script.repairOrphanedUser({
            uid: 'u1', email: 'ada@example.org', fullName: 'Ada Nwosu',
        });

        expect(result.created).toBe(false);
        expect(store.get('users', 'u1')).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#329 — the capped reads', () => {
    afterEach(() => { process.argv = ORIGINAL_ARGV; });

    it('mark-unpaid considers all 5,001 users, not the first 5,000', async () => {
        jest.clearAllMocks();
        const users: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) {
            users[`u${i}`] = { serviceRegistrations: { academy: { status: 'approved' } } };
        }
        installFakeDb({ users });

        const script = await import('../../../src/scripts/mark-unpaid');
        const targets = await script.markUnpaid();

        expect(targets.length).toBe(5001);
    }, 240_000);

    it('and treats an ABSENT paymentStatus as not-completed, reporting it as such', async () => {
        jest.clearAllMocks();
        installFakeDb({
            users: {
                absent: { serviceRegistrations: { academy: { status: 'approved' } } },
                pending: { serviceRegistrations: { academy: { status: 'approved', paymentStatus: 'pending' } } },
                paid: { serviceRegistrations: { academy: { status: 'approved', paymentStatus: 'completed' } } },
                noAcademy: { email: 'a@b.c' },
            },
        });

        const script = await import('../../../src/scripts/mark-unpaid');
        const targets = await script.markUnpaid();

        expect(targets.map((t) => t.userId).sort()).toEqual(['absent', 'pending']);
        expect(targets.find((t) => t.userId === 'absent')?.current).toBe('(absent)');
    });

    it('mark-unpaid writes nothing without --apply', async () => {
        jest.clearAllMocks();
        const store = installFakeDb({
            users: { u1: { serviceRegistrations: { academy: { status: 'approved' } } } },
        });

        const script = await import('../../../src/scripts/mark-unpaid');
        await script.markUnpaid();

        expect(store.get('users', 'u1')?.serviceRegistrations.academy.paymentStatus).toBeUndefined();
        expect(global.mockFirestoreBatchCommit).not.toHaveBeenCalled();
    });

    it('backfill_versions counts all 5,001 members, not the first 5,000', async () => {
        jest.clearAllMocks();
        const members: Record<string, any> = {};
        for (let i = 0; i < 5001; i++) members[`m${i}`] = { userId: `m${i}` };
        installFakeDb({ cooperative_members: members });

        const script = await import('../../../src/scripts/backfill_versions');
        const counts = await script.backfillVersions();

        expect(counts.members).toBe(5001);
    }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#329 — one convention across every writing script', () => {
    /**
     * A class ratchet. The point is not these ten files; it is that an eleventh
     * cannot arrive with an eleventh idea of what "safe to run" means, the way
     * seven of these did.
     */
    it('every script that writes is REPORT-ONLY until --apply', () => {
        const missing = WRITING_SCRIPTS.filter((rel) => {
            const src = stripComments(read(rel));
            return !src.includes('isApply(') && !src.includes("'--apply'");
        });
        expect(missing).toEqual([]);
    });

    it('AND NONE OF THEM EXITS 0 AFTER FAILING', () => {
        // `.catch(console.error)` logs and exits successfully. Three did this.
        const swallowing = [...WRITING_SCRIPTS, 'scripts/audit-data-integrity.ts'].filter((rel) => {
            const src = stripComments(read(rel));
            return /\.catch\(console\.error\)/.test(src);
        });
        expect(swallowing).toEqual([]);
    });

    it('every script that exits does so through runScript or an explicit exit(1)', () => {
        const unguarded = [...WRITING_SCRIPTS, 'scripts/audit-data-integrity.ts'].filter((rel) => {
            const src = stripComments(read(rel));
            return !src.includes('runScript(') && !src.includes('process.exit(1)');
        });
        expect(unguarded).toEqual([]);
    });

    it('NO WHOLE-COLLECTION READ IS LEFT UNBOUNDED', () => {
        // `.collection(X).get()` with no .limit() and no .all() stops at 5,000
        // and reports the page as the collection.
        const offenders: string[] = [];
        for (const rel of [...WRITING_SCRIPTS, 'scripts/audit-data-integrity.ts']) {
            const src = stripComments(read(rel));
            // A collection or collectionGroup read that goes straight to .get().
            const bare = src.match(/\.(collection|collectionGroup)\([^)]*\)\s*\.get\(\)/g) ?? [];
            if (bare.length > 0) offenders.push(`${rel}: ${bare.join(', ')}`);
        }
        expect(offenders).toEqual([]);
    });

    it('POSITIVE CONTROL: that scan finds a bare read when there is one', () => {
        const sample = 'const s = await db.collection(COLLECTIONS.USERS).get();';
        expect(sample.match(/\.(collection|collectionGroup)\([^)]*\)\s*\.get\(\)/g)).toHaveLength(1);
        const fixed = 'const s = await db.collection(COLLECTIONS.USERS).all().get();';
        expect(fixed.match(/\.(collection|collectionGroup)\([^)]*\)\s*\.get\(\)/g)).toBeNull();
    });

    it('VACUITY GUARD: the ratchet is actually looking at files', () => {
        expect(WRITING_SCRIPTS.length).toBeGreaterThanOrEqual(10);
        for (const rel of WRITING_SCRIPTS) {
            expect({ rel, length: read(rel).length > 200 }).toEqual({ rel, length: true });
        }
    });

    it('and the list has not fallen behind the directory', () => {
        // A new writing script that nobody adds to WRITING_SCRIPTS is invisible
        // to every assertion above. This catches that.
        const WRITE = /\bbatch\.(set|update|delete)\(|\.\s*set\(|\.\s*update\(|\.\s*add\(/;
        const found: string[] = [];
        for (const dir of ['scripts', 'src/scripts']) {
            for (const name of readdirSync(join(ROOT, dir))) {
                if (!name.endsWith('.ts') || name.startsWith('_')) continue;
                const rel = `${dir}/${name}`;
                if (WRITE.test(stripComments(read(rel)))) found.push(rel);
            }
        }
        const unlisted = found.filter(
            (rel) => !WRITING_SCRIPTS.includes(rel)
                && !['scripts/seed-local.ts', 'src/scripts/cleanup-firebase.ts',
                    'src/scripts/auth-purge-orphans.ts', 'scripts/audit-data-integrity.ts',
                    'scripts/academy-schema-repair.ts',
                    // NOT a writing script. The detector matches `.add(`,
                    // and this module's only match is a JavaScript
                    // `Set.add` while deduplicating learners — it holds
                    // pure arithmetic and imports no database client at
                    // all. Listed rather than loosening the regex: a
                    // narrower detector would start missing real writes.
                    'scripts/academy-enrolment-tally.ts'].includes(rel),
        );
        expect(unlisted).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#329 — the audit report lands somewhere', () => {
    const src = stripComments(read('scripts/audit-data-integrity.ts'));

    it('creates the artifacts directory before writing into it', () => {
        // ./artifacts/ is not in the repository and nothing created it, so
        // writeFileSync threw ENOENT after the audit had already run.
        expect(src).toMatch(/mkdirSync\([^)]*\{\s*recursive:\s*true\s*\}\s*\)/);
        // And the mkdir comes before the write.
        expect(src.indexOf('mkdirSync')).toBeLessThan(src.indexOf('writeFileSync'));
    });
});
