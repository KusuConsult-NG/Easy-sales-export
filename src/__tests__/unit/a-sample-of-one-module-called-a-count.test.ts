/**
 * @jest-environment node
 */

/**
 *   #772 "ORPHANED APPS: 3" WAS A FIFTY-ROW SAMPLE OF ONE MODULE OUT OF FOUR,
 *        PRINTED AS A COUNT.
 *
 *   The owner asked what the System Health tile means:
 *
 *       Orphaned Apps
 *       3
 *       Missing User Linkages
 *
 *   It means three WAVE applications point at a member account that is not
 *   there — either no `userId` at all, or a `userId` whose user document is
 *   gone. That matters: every one of the four approval paths reads `userId` to
 *   grant the module role and write the registration, so an orphan is an
 *   application NO ADMIN CAN ACTION. Three women who applied to WAVE and whose
 *   applications cannot be approved by anybody.
 *
 *   The number itself was wrong in two ways, and they are this audit's two
 *   commonest failures arriving in one figure.
 *
 * ── (1) A BOUNDED SCAN PRESENTED AS A MEASUREMENT ───────────────────────────
 *
 *       const waveSnap = await db.collection(WAVE_APPLICATIONS).limit(50).get();
 *
 *   Fifty rows, no ordering, under a comment that says "(Sample)" — and the
 *   tile rendered the result as a bare number. So "3" means "3 of the first 50
 *   rows the database happened to return", and the platform figure is unknown.
 *   #516 removed the same shape from getFinancialOverview — "reporting the size
 *   of one page as the platform's lifetime total" — and #753 closed a ledger of
 *   sixteen more across the admin screens.
 *
 * ── (2) A LABEL NAMING A CLASS, A CHECK COVERING A QUARTER OF IT ────────────
 *
 *   The heading says "Orphaned Apps". The query read WAVE and nothing else.
 *   Academy, Export and Farm Nation applications all carry the same `userId`
 *   and all four are approved through it, so three of the four were never
 *   looked at — the dominant defect class of this whole audit, on the screen
 *   that exists to find defects.
 *
 * ── AND IT NOW COSTS LESS THAN THE ONE-MODULE VERSION ───────────────────────
 *
 *   The old check did one `.doc(userId).get()` PER APPLICATION — up to fifty
 *   round trips on the page an administrator opens BECAUSE something is wrong.
 *   The ids are batched now, so four modules at fifty rows each is about seven
 *   queries rather than two hundred.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    scanOrphanedApplications,
    APPLICATION_COLLECTIONS,
    ORPHAN_SCAN_LIMIT,
} from '@/lib/orphaned-applications';
import { COLLECTIONS } from '@/lib/types/firestore';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const HEALTH = 'src/app/actions/health.ts';

/**
 * A stand-in adapter.
 *
 * `apps` maps a collection name to its rows; `users` is the set of user ids
 * that exist. `queries` records every read so cost can be asserted rather than
 * assumed.
 */
function fakeDb(apps: Record<string, Array<{ userId?: unknown }>>, users: string[], opts: {
    failCollections?: string[];
    failUserLookup?: boolean;
} = {}) {
    const queries: string[] = [];
    const present = new Set(users);

    return {
        queries,
        db: {
            collection(name: string) {
                if (name === COLLECTIONS.USERS) {
                    return {
                        where: (_f: unknown, _op: string, ids: string[]) => ({
                            get: async () => {
                                queries.push(`users:in(${ids.length})`);
                                if (opts.failUserLookup) throw new Error('users down');
                                return { docs: ids.filter((id) => present.has(id)).map((id) => ({ id })) };
                            },
                        }),
                    };
                }
                return {
                    limit: (n: number) => ({
                        get: async () => {
                            queries.push(`${name}:limit(${n})`);
                            if (opts.failCollections?.includes(name)) throw new Error('collection down');
                            const rows = (apps[name] ?? []).slice(0, n);
                            return { docs: rows.map((r, i) => ({ id: `${name}-${i}`, data: () => r })) };
                        },
                    }),
                };
            },
        },
    };
}

const W = COLLECTIONS.WAVE_APPLICATIONS;
const A = COLLECTIONS.ACADEMY_APPLICATIONS;
const E = COLLECTIONS.EXPORT_APPLICATIONS;
const F = COLLECTIONS.FARM_NATION_APPLICATIONS;

// ─────────────────────────────────────────────────────────────────────────────
describe('#772 — the scan covers every module the label names', () => {
    it('ALL FOUR APPLICATION COLLECTIONS ARE READ', async () => {
        //   THE test. The old check read WAVE and nothing else.
        const { db, queries } = fakeDb({}, []);

        await scanOrphanedApplications(db);

        for (const { collection } of APPLICATION_COLLECTIONS) {
            expect({ collection, read: queries.some((q) => q.startsWith(`${collection}:`)) })
                .toEqual({ collection, read: true });
        }
    });

    it('AND THE FOUR ARE THE ONES THAT APPROVE BY userId', () => {
        //   Pinned as a set, so a module added to the platform without joining
        //   this scan is a failure here rather than a silent gap.
        expect(APPLICATION_COLLECTIONS.map((c) => c.module).sort())
            .toEqual(['academy', 'export', 'farm-nation', 'wave']);
    });

    it('AN ORPHAN IN ACADEMY IS FOUND — one of the three that were invisible', async () => {
        const { db } = fakeDb({ [A]: [{ userId: 'gone' }, { userId: 'alive' }] }, ['alive']);

        const scan = await scanOrphanedApplications(db);

        expect(scan.orphaned).toBe(1);
        expect(scan.byModule.academy).toBe(1);
        expect(scan.byModule.wave).toBe(0);
    });

    it('AND BOTH SHAPES COUNT: no userId, and a userId with no user', async () => {
        /*
         *   The old check counted both, and neither can be approved — the
         *   approval paths read `userId` to grant the role.
         */
        const { db } = fakeDb({
            [W]: [{ userId: 'gone' }, {}, { userId: '' }, { userId: 'alive' }],
        }, ['alive']);

        const scan = await scanOrphanedApplications(db);

        expect(scan.orphaned).toBe(3);
    });

    it('CONTROL — a fully linked platform reports nothing', async () => {
        //   A scan that always finds orphans would satisfy every assertion
        //   above and be useless.
        const { db } = fakeDb({
            [W]: [{ userId: 'a' }], [A]: [{ userId: 'b' }],
            [E]: [{ userId: 'c' }], [F]: [{ userId: 'd' }],
        }, ['a', 'b', 'c', 'd']);

        const scan = await scanOrphanedApplications(db);

        expect(scan.orphaned).toBe(0);
        expect(scan.scanned).toBe(4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#772 — the figure says what it was measured over', () => {
    it('IT REPORTS HOW MANY ROWS IT READ', async () => {
        const { db } = fakeDb({ [W]: [{ userId: 'a' }, { userId: 'b' }], [A]: [{ userId: 'c' }] }, ['a', 'b', 'c']);

        const scan = await scanOrphanedApplications(db);

        expect(scan.scanned).toBe(3);
    });

    it('AND SAYS WHEN THE COUNT IS A FLOOR', async () => {
        /*
         *   Hitting the limit means there may be more beyond it. Without this
         *   the screen cannot tell a finding from a floor, which is the whole
         *   of this finding.
         */
        const rows = Array.from({ length: ORPHAN_SCAN_LIMIT }, () => ({ userId: 'gone' }));
        const { db } = fakeDb({ [W]: rows }, []);

        const scan = await scanOrphanedApplications(db);

        expect(scan.bounded).toBe(true);
        expect(scan.orphaned).toBe(ORPHAN_SCAN_LIMIT);
    });

    it('AND DOES NOT CLAIM A FLOOR WHEN IT READ EVERYTHING', async () => {
        //   The other direction. Marking every scan as bounded would make the
        //   warning meaningless, which is how a caveat stops being read.
        const { db } = fakeDb({ [W]: [{ userId: 'a' }] }, ['a']);

        expect((await scanOrphanedApplications(db)).bounded).toBe(false);
    });

    it('AND THE SCREENS PRINT IT', () => {
        //   Both doors. The note in diagnostics/page.tsx records what it cost
        //   last time a fix on this pair reached one of the two.
        for (const screen of [
            'src/app/admin/system-health/page.tsx',
            'src/app/admin/system-health/diagnostics/page.tsx',
        ]) {
            const src = code(screen);
            expect({ screen, says: src.includes('orphanedApplicationsScanned') && src.includes('checked') })
                .toEqual({ screen, says: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#772 — a failed read is not "no orphans"', () => {
    it('AN UNREADABLE COLLECTION IS NAMED, NOT COUNTED AS ZERO', async () => {
        /*
         *   #516's rule on a figure an operator acts on. Reporting a collection
         *   nobody could read as clean is the defect this whole class is about.
         */
        const { db } = fakeDb({ [W]: [{ userId: 'gone' }] }, [], { failCollections: [A] });

        const scan = await scanOrphanedApplications(db);

        expect(scan.unreadable).toContain('academy');
        expect(scan.orphaned).toBe(1);
    });

    it('AND A FAILED USER LOOKUP DOES NOT INVENT ORPHANS', async () => {
        /*
         *   The direction that matters most. Treating an unanswered existence
         *   check as "these accounts are missing" would report a database
         *   wobble as members who have vanished — the loudest possible false
         *   alarm on this screen.
         */
        const { db } = fakeDb({ [W]: [{ userId: 'a' }, { userId: 'b' }] }, [], { failUserLookup: true });

        const scan = await scanOrphanedApplications(db);

        expect(scan.orphaned).toBe(0);
        expect(scan.unreadable).toContain('users');
    });

    it('and it never throws, whatever fails', async () => {
        //   This runs while a health page renders. A diagnostic that takes the
        //   screen down is the one thing it must not do.
        const { db } = fakeDb({}, [], { failCollections: [W, A, E, F], failUserLookup: true });

        await expect(scanOrphanedApplications(db)).resolves.toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#772 — and it costs less than the version that checked one module', () => {
    it('THE EXISTENCE CHECKS ARE BATCHED, NOT ONE PER APPLICATION', async () => {
        /*
         *   The old shape was `.doc(userId).get()` inside a map over fifty
         *   rows. Forty distinct ids across four modules is a handful of
         *   chunked reads, not forty.
         */
        const ids = Array.from({ length: 40 }, (_, i) => `u${i}`);
        const { db, queries } = fakeDb({
            [W]: ids.slice(0, 10).map((userId) => ({ userId })),
            [A]: ids.slice(10, 20).map((userId) => ({ userId })),
            [E]: ids.slice(20, 30).map((userId) => ({ userId })),
            [F]: ids.slice(30, 40).map((userId) => ({ userId })),
        }, ids);

        await scanOrphanedApplications(db);

        const userQueries = queries.filter((q) => q.startsWith('users:'));
        //   40 ids, chunked at 30 → two reads. Not forty.
        expect(userQueries).toHaveLength(2);
    });

    it('AND THE OLD PER-ROW READ IS GONE FROM THE HEALTH ACTION', () => {
        const src = code(HEALTH);

        expect(src).toContain('scanOrphanedApplications(db)');
        //   The shape it replaced, stated as its absence.
        expect(src).not.toContain('const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();');
        expect(src).not.toContain('db.collection(COLLECTIONS.WAVE_APPLICATIONS).limit(50)');
    });

    it('and it asks nothing of the users collection when no row names one', async () => {
        const { db, queries } = fakeDb({ [W]: [{}, {}] }, []);

        const scan = await scanOrphanedApplications(db);

        expect(queries.filter((q) => q.startsWith('users:'))).toEqual([]);
        expect(scan.orphaned).toBe(2);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH.
 *
 *     MUTANT                                                        RESULT
 *     the scan reads WAVE only, as before                             KILLED
 *     a missing userId stops counting as an orphan                    KILLED
 *     `bounded` is never set                                          KILLED
 *     `bounded` is always set                                         KILLED
 *     `scanned` reports the orphan count instead of rows read         KILLED
 *     an unreadable collection is silently skipped                    KILLED
 *     a failed user lookup marks every id ABSENT                      KILLED
 *     the lookup chunk drops to 1 (one query per id)                  KILLED
 *     the health action keeps the old per-row read                    KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   The failed-lookup mutant is the one worth naming: it turns a database
 *   wobble into a report that every applicant's account has vanished, which is
 *   worse than the under-count this finding started from.
 */
