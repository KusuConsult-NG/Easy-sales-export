/**
 * @jest-environment node
 */

/**
 *   #728 ONE FORENSIC CHECK OF ELEVEN KNEW THAT A SWEEP WHICH STOPS SHORT
 *        CANNOT REPORT "CLEAN". THE OTHERS SAMPLED AND SAID "PASS".
 *
 *   The Investment Cap check states the rule in its own comment and obeys it:
 *
 *       ".all(), because a forensic sweep that stops at the default cap reports
 *        'no breaches' for the windows it did not read."
 *
 *   Every other limited check did the opposite. PROVED BY EXECUTION before
 *   anything was changed — the academy check seeded with exactly fifty active
 *   enrolments, its `.limit(50)` ceiling, and no problem among them:
 *
 *       status  : pass
 *       details : "Scanned 50 active enrolments against checkCourseAccess.
 *                  Found 0 on a course their plan does not open."
 *
 *   A green tick. If that collection holds five thousand enrolments, four
 *   thousand nine hundred and fifty were never examined and the owner has been
 *   told the platform is clean.
 *
 * ── THE FIFTH TIME THIS PLATFORM HAS FOUND THE SAME DEFECT ──────────────────
 *
 *   #331 found TWO checks "reporting 'pass' for questions they could not ask".
 *   #372 found a third. #373 found a fourth and wrote the rule plainly:
 *   "reporting 'no breach' for them is the same false green line."
 *
 *   Those four could not ask their question because they read fields nothing
 *   writes. This is the same sentence with a different cause: the check asks
 *   the right question, of five percent of the rows, and answers for all of
 *   them.
 *
 * ── WHY THE SNAPSHOT'S OWN `truncated` FLAG DID NOT COVER IT ────────────────
 *
 *   It looks like it should. supabase-db computes:
 *
 *       truncated = this._unbounded
 *           ? fetchedSoFar >= UNBOUNDED_CEILING
 *           : this._limit == null && fetchedSoFar >= DEFAULT_QUERY_LIMIT;
 *
 *   `this._limit == null` — so a query carrying an explicit `.limit(50)` has
 *   `truncated === false` however many rows the collection holds. Reading it in
 *   a sampling check would have been a guard that cannot fire, which is the
 *   defect class this file is about.
 *
 * ── WHAT DID NOT CHANGE, WHICH IS THE POINT ─────────────────────────────────
 *
 *   A PROBLEM FOUND IN A SAMPLE IS STILL REPORTED AS A PROBLEM. Five orphaned
 *   products among two hundred are five orphaned products. No finding is
 *   downgraded, hidden or softened by this change — the asymmetry is the whole
 *   design and it is asserted below in both directions.
 *
 *   And the sampling itself stays. The forensics screen's own note explains
 *   why: "It runs on demand. The scan reads across eight collections; firing it
 *   on navigation would charge that cost to every visit." Turning ten sampled
 *   checks into unbounded sweeps would make the report one nobody runs. The
 *   defect was never the sampling — it was claiming completeness it did not
 *   have.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import { sampleOf, verdictFor, describeSample } from '@/lib/forensic-scan-scope';

const FORENSICS = 'src/app/actions/forensics.ts';
const code = () => stripComments(readFileSync(FORENSICS, 'utf-8'), { label: FORENSICS });

// ─────────────────────────────────────────────────────────────────────────────
describe('#728 — what a sample entitles a check to claim', () => {
    it('A SCAN THAT SAW EVERYTHING AND FOUND NOTHING PASSES', () => {
        expect(verdictFor(sampleOf(12, 50), 0, 'fail')).toBe('pass');
    });

    it('AND A SCAN THAT FILLED ITS CEILING AND FOUND NOTHING DOES NOT — THE defect', () => {
        /*
         *   The one verdict that changes. 50 rows out of a ceiling of 50 is
         *   indistinguishable from 50 out of 5,000 — the two worlds produce an
         *   identical result — so the honest answer is the status this codebase
         *   already created for a question it could not fully ask.
         */
        expect(verdictFor(sampleOf(50, 50), 0, 'fail')).toBe('inconclusive');
    });

    it('AND A PROBLEM FOUND IN A SAMPLE IS STILL A PROBLEM — NOTHING IS DOWNGRADED', () => {
        //   THE direction that must not move. Absence in a sample proves
        //   nothing; PRESENCE in one is conclusive. A finding stays a finding
        //   whether or not the rest of the collection was read.
        expect(verdictFor(sampleOf(50, 50), 5, 'fail')).toBe('fail');
        expect(verdictFor(sampleOf(50, 50), 5, 'warning')).toBe('warning');
        expect(verdictFor(sampleOf(12, 50), 1, 'fail')).toBe('fail');
    });

    it('AND THE BOUNDARY IS TREATED AS INCOMPLETE, NOT COMPLETE', () => {
        //   `scanned < ceiling` strictly. Treating equality as complete would
        //   make the honest and dishonest cases agree at exactly the point
        //   where they differ.
        expect(sampleOf(49, 50).complete).toBe(true);
        expect(sampleOf(50, 50).complete).toBe(false);
        //   And an adapter handing back one row more than asked for cannot
        //   slip through as complete.
        expect(sampleOf(51, 50).complete).toBe(false);
    });

    it('AND AN EMPTY COLLECTION IS COMPLETE, NOT UNKNOWN', () => {
        //   Nothing to read is a fact about the collection, not a failure to
        //   read it — the same reasoning #726 applied to a ₦0 balance.
        expect(sampleOf(0, 50).complete).toBe(true);
        expect(verdictFor(sampleOf(0, 50), 0, 'fail')).toBe('pass');
    });

    it('AND THE SENTENCE SAYS WHICH KIND OF SCAN IT WAS', () => {
        expect(describeSample(sampleOf(12, 50), 'products')).toBe('Scanned all 12 products.');

        const partial = describeSample(sampleOf(50, 50), 'products');
        expect(partial).toContain('50 products');
        expect(partial).toContain('NOT examined');
        //   #671's rule: the line has to be one an operator can act on, so it
        //   states the consequence rather than hedging.
        expect(partial).toContain('a clean result here is not a clean collection');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#728 — and the scan itself, executed', () => {
    const ADMIN = 'admin-1';

    function setSession(uid: string, roles: string[]) {
        (global as any).mockRequireSession.mockResolvedValue({
            session: { user: { id: uid, roles, email: 'a@b.c' } },
            response: null,
        });
    }

    /** `count` products, every one owned by a seller who exists. Nothing wrong. */
    function seedCleanProducts(count: number) {
        const products = Array.from({ length: count }, (_, i) => ({
            id: `p-${i}`,
            data: () => ({ sellerId: 's1' }),
        }));
        (global as any).mockFirestoreGet.mockImplementation((c: string) => {
            const empty = {
                exists: false, empty: true, size: 0, docs: [], truncated: false, data: () => ({}),
            };
            if (c === COLLECTIONS.PRODUCTS) {
                return Promise.resolve({
                    exists: false, empty: count === 0, size: count, truncated: false,
                    docs: products, data: () => ({}),
                });
            }
            if (c === COLLECTIONS.USERS) {
                //   The seller is alive, so no product is an orphan.
                return Promise.resolve({
                    exists: false, empty: false, size: 1, truncated: false, data: () => ({}),
                    docs: [{ id: 's1', data: () => ({ deleted: false }) }],
                });
            }
            return Promise.resolve(empty);
        });
        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: false, empty: true, size: 0, docs: [], truncated: false, data: () => ({}),
        }));
    }

    async function orphanCheck() {
        const { runForensicScanAction } = await import('@/app/actions/forensics');
        const res: any = await runForensicScanAction();
        const results = res?.data?.results ?? res?.results ?? [];
        return results.find((r: any) => r.check === 'Orphaned Products (Deleted Seller)');
    }

    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
    });

    it('A CLEAN SCAN THAT READ THE WHOLE COLLECTION STILL PASSES', async () => {
        //   Vacuity guard on the test below. If this were also inconclusive the
        //   change would have broken the check rather than corrected it, and a
        //   report where nothing can ever pass is as useless as one where
        //   everything does.
        seedCleanProducts(7);
        const r = await orphanCheck();

        expect(r.status).toBe('pass');
        expect(r.details).toContain('Scanned all 7 products');
    });

    it('AND A CLEAN SCAN THAT FILLED ITS CEILING NO LONGER DOES — THE fix', async () => {
        /*
         *   200 is the products ceiling. Before this finding the same seeded
         *   world produced status "pass" and "Scanned 200 products. Found 0
         *   orphans." — a green tick over a collection it had read 200 rows of.
         */
        seedCleanProducts(200);
        const r = await orphanCheck();

        expect(r.status).toBe('inconclusive');
        expect(r.details).toContain('NOT examined');
        expect(r.details).toContain('Found 0 orphans');
    });

    it('AND A SAMPLE THAT FINDS AN ORPHAN STILL FAILS, CEILING OR NOT', async () => {
        //   The asymmetry, executed rather than asserted against the helper
        //   alone: a full sample carrying a real problem must still be red.
        const products = Array.from({ length: 200 }, (_, i) => ({
            id: `p-${i}`,
            data: () => ({ sellerId: i === 0 ? 'gone' : 's1' }),
        }));
        (global as any).mockFirestoreGet.mockImplementation((c: string) => {
            if (c === COLLECTIONS.PRODUCTS) {
                return Promise.resolve({
                    exists: false, empty: false, size: 200, truncated: false,
                    docs: products, data: () => ({}),
                });
            }
            if (c === COLLECTIONS.USERS) {
                return Promise.resolve({
                    exists: false, empty: false, size: 1, truncated: false, data: () => ({}),
                    docs: [{ id: 's1', data: () => ({ deleted: false }) }],
                });
            }
            return Promise.resolve({
                exists: false, empty: true, size: 0, docs: [], truncated: false, data: () => ({}),
            });
        });
        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: false, empty: true, size: 0, docs: [], truncated: false, data: () => ({}),
        }));

        const r = await orphanCheck();

        expect(r.status).toBe('fail');
        expect(r.affectedIds).toContain('p-0');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#728 — every ceiling is one number, read twice', () => {
    it('THE LIMITS ARE NAMED, NOT WRITTEN OUT AT EACH USE', () => {
        /*
         *   The query and the verdict both need the ceiling. As literals they
         *   are two copies of one fact, and raising a `.limit()` without
         *   touching the comparison puts the check straight back to claiming a
         *   completeness it does not have — silently, which is how this got
         *   here.
         */
        const src = code();

        expect(src).toContain('const SCAN_CEILING = {');
        for (const key of [
            'authUsers', 'blankEmail', 'products', 'verifications',
            'waveApplicants', 'coopMembers', 'farmers', 'enrolments',
        ]) {
            expect(src).toContain(`SCAN_CEILING.${key}`);
        }
    });

    it('AND NO SAMPLED QUERY CARRIES A BARE NUMERIC LIMIT ANY MORE', () => {
        /*
         *   The claim above is satisfiable by adding constants beside the old
         *   literals. This is the half that makes it mean something.
         *
         *   `PAGE` is exempt: the duplicate-profile check pages through the
         *   whole collection rather than sampling it, so its limit is a batch
         *   size and not a ceiling on what the check sees.
         */
        const bare = code()
            .split('\n')
            .filter((l) => /\.limit\(\s*\d+\s*\)/.test(l));

        expect(bare).toEqual([]);
    });

    it('AND EVERY CEILING NAMED IS ACTUALLY USED TO LIMIT A QUERY', () => {
        //   Vacuity guard in the other direction: a constant nobody passes to
        //   `.limit()` or `listUsers()` is decoration, and would let the two
        //   assertions above pass over a check that still samples blind.
        const src = code();
        for (const key of ['blankEmail', 'products', 'verifications',
            'waveApplicants', 'coopMembers', 'farmers', 'enrolments']) {
            expect(src).toContain(`.limit(SCAN_CEILING.${key})`);
        }
        expect(src).toContain('listUsers(SCAN_CEILING.authUsers)');
    });

    it('AND EVERY SAMPLED CHECK DECIDES ITS VERDICT THROUGH THE SHARED RULE', () => {
        //   Eight scopes, one per sampled check. Counted rather than listed so
        //   a check that stopped using it fails here.
        const src = code();
        const scopes = (src.match(/sampleOf\(/g) ?? []).length;
        const verdicts = (src.match(/verdictFor\(/g) ?? []).length;

        expect(scopes).toBeGreaterThanOrEqual(8);
        expect(verdicts).toBeGreaterThanOrEqual(8);
    });

    it('AND THE CHECK THAT ALREADY DID IT RIGHT IS UNTOUCHED', () => {
        /*
         *   The Investment Cap check sweeps with `.all()` and reads the
         *   snapshot's `truncated` flag — which is correct for an unbounded
         *   query, and is where the rule this finding generalises was already
         *   written down. It must not be converted to a sample.
         */
        const src = code();

        expect(src).toContain('.all()');
        expect(src).toContain('activeWindows.truncated');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk.
 *
 *     MUTANT                                                        RESULT
 *     a full sample reporting nothing goes back to "pass"            KILLED
 *     the boundary counts as complete (scanned <= ceiling)           KILLED
 *     a problem found in a full sample is downgraded                 KILLED
 *     an empty collection reads as incomplete                        KILLED
 *     the "NOT examined" sentence is dropped                         KILLED
 *     a check goes back to a bare .limit(200)                        KILLED
 *     a ceiling constant is declared but the query keeps its literal KILLED
 *     the academy check stops using the shared rule                  KILLED
 *     the Investment Cap sweep is converted to a sample              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
