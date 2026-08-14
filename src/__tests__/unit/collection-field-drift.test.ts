/**
 * @jest-environment node
 */

/**
 * Two writers of one collection that did not agree on the field name.
 *
 * WHY A SCANNER FOR THIS
 * ----------------------
 * Three defects in this audit had the same shape, and none of the other
 * scanners could see any of them, because each writer is correct on its own
 * terms. The defect exists only in the relationship BETWEEN writers of a
 * collection, or between a writer and a reader:
 *
 *   announcements (#143)   one writer omitted `content` and `targetAudience`;
 *                          the only reader needs both. Every row it wrote was
 *                          invisible.
 *   certificates (#144)    two kinds of record in one collection; three readers
 *                          assumed one kind, including a public verify endpoint.
 *   loan_products (#145)   one writer validated, the other wrote what arrived.
 *
 * So: group every write by collection, compare what the creates write, and
 * compare that against what the readers query.
 *
 * WHAT IT FOUND
 * -------------
 *
 * 1. THE ACADEMY FIELD RENAME
 *
 * `autoEnrollPaidUser` was fixed at some point to take the caller from the
 * session, and the local was renamed userId -> resolvedUserId. The rename was
 * applied inside the query STRING LITERALS and the written field names too:
 *
 *     .where("resolvedUserId", "==", resolvedUserId)
 *     await progressRef.set({ resolvedUserId, courseId, ... })
 *
 * Nothing anywhere writes a column called `resolvedUserId` — course-actions.ts,
 * which is the real enrolment path, writes `userId`. So both dedup queries
 * matched nothing, every time. Three consequences, and the second cost data:
 *
 *   Every row this function wrote was invisible to every other reader, so an
 *   auto-enrolled course never appeared in the learner's course list.
 *
 *   `existingProgresses` was always empty, so the function re-set
 *   COURSE_PROGRESS at `${userId}_${courseId}` — the SAME document
 *   enrollInCourse, updateLessonProgress and completeCourse all use — merging
 *   progressPercent: 0, completed: false, completedAt: null over whatever the
 *   learner had actually done. It runs on every academy dashboard load, so a
 *   paid learner's progress was zeroed the next time they opened the dashboard.
 *
 *   `existingEnrollments` was always empty, so a learner who had enrolled
 *   properly got a duplicate enrolment row.
 *
 * Each self-limits after one run, because the row it then writes DOES carry
 * `resolvedUserId` and the query finds it next time. That is exactly why this
 * never looked like an ongoing fault, and why nobody found it by using the site.
 *
 * The fix reads BOTH field names and takes the union, so rows already written
 * with the wrong name are recognised rather than zeroed one last time — no
 * backfill needed. And the one write that can destroy something now checks the
 * document by its deterministic id, so a wrong guard cannot cost progress again.
 *
 * 2. A LAND LISTING NOBODY COULD SEE
 *
 * /api/farm-nation/create-listing wrote `userId` and `verificationStatus`.
 * Every reader of LAND_LISTINGS uses `ownerId` and `status` — the owner's
 * "my listings" query, the browse list, and the admin verification queue — and
 * the other writer of the collection writes both. So a listing created there was
 * invisible to its own owner, never entered the review queue, and could
 * therefore never become verified and appear in the marketplace.
 *
 * `pending_verification` rather than `draft`, because the route sets
 * verificationStatus: "pending" — it submits rather than saving a draft — and
 * `draft` is not in land-listing-status.ts's vocabulary at all.
 *
 * TRIAGED AND NOT CHANGED
 * -----------------------
 *   ESCROW_TRANSACTIONS.releaseRequestedAt   written on a transition, not at
 *                                            create. Correct.
 *   WALLET_TRANSACTIONS balanceBefore/After  order-management.ts writes a row
 *                                            without them and the wallet
 *                                            statement UI renders them, so that
 *                                            line shows no running balance.
 *                                            Real, cosmetic, and fixing it
 *                                            properly needs the balance from the
 *                                            ledger primitive. Reported.
 *   COURSE_ENROLLMENTS.resolvedUserId        the scanner still reports this,
 *                                            correctly: readers query it and no
 *                                            writer supplies it. That is now
 *                                            deliberate — the legacy read exists
 *                                            to find rows the bug left behind.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { reportByCollection, scanWriteSites } from '@/lib/testing/collection-writer-scan';

describe('the scanner reads the write surface', () => {
    const sites = scanWriteSites();

    it('finds writes across many collections (sanity)', () => {
        // Without this the assertions below pass against an empty scan.
        expect(sites.length).toBeGreaterThan(100);
        expect(new Set(sites.map((s) => s.collection)).size).toBeGreaterThan(30);
    });

    it('counts set(..., { merge: true }) as an update, not a create', () => {
        // THE correction that made it usable. Counting merges as creates
        // produced 300-odd findings, almost all of them partial upserts
        // "omitting" fields they were never meant to write, and every real
        // finding drowned.
        const merges = sites.filter((s) =>
            s.file.includes('course-actions.ts') && s.collection === 'COURSE_PROGRESS');

        expect(merges.length).toBeGreaterThan(0);
        for (const m of merges) expect(m.kind).toBe('update');
    });

    it('stays under a readable number of findings', () => {
        // A lead list nobody reads is worth nothing. The point of the merge
        // correction and the five-key floor.
        const findings = reportByCollection().flatMap((r) => r.findings);

        expect(findings.length).toBeLessThan(30);
    });
});

describe('the academy rename, and what it cost', () => {
    async function academySource(): Promise<string> {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        return readFileSync(join(process.cwd(), 'src/app/actions/academy/_ac_enrollment.ts'), 'utf-8');
    }

    it('writes the field every other reader queries', async () => {
        // THE test. course-actions.ts writes `userId`; this wrote
        // `resolvedUserId`, so its rows were invisible to every other reader.
        const src = await academySource();
        const fn = src.slice(src.indexOf('export async function autoEnrollPaidUser'));

        // The shorthand `{ resolvedUserId, courseId ... }` is what wrote the
        // wrong column name.
        expect(fn).not.toMatch(/\{\s*\n\s*resolvedUserId,/);
        expect(fn).toContain('userId: resolvedUserId');
    });

    it('queries the field every other writer writes', async () => {
        const src = await academySource();
        const fn = src.slice(src.indexOf('export async function autoEnrollPaidUser'));

        expect(fn).toContain('.where("userId", "==", resolvedUserId)');
    });

    it('still reads the legacy field, so corrupted rows are recognised', async () => {
        // Rows written while the name was wrong carry `resolvedUserId`. Querying
        // only `userId` would miss them — and missing them is what zeroes
        // progress. Reading both means the damage stops without a backfill.
        const src = await academySource();
        const fn = src.slice(src.indexOf('export async function autoEnrollPaidUser'));

        expect(fn).toContain('.where("resolvedUserId", "==", resolvedUserId)');
    });

    it('checks the progress document by id before overwriting it', async () => {
        // The write that can destroy something. Its id is deterministic, so its
        // existence is knowable without trusting any query — and it merges
        // zeros over progressPercent, completed and completedAt.
        const src = await academySource();
        const fn = src.slice(src.indexOf('export async function autoEnrollPaidUser'));

        const guardAt = fn.indexOf('alreadyHasProgress');
        // The COURSE_PROGRESS write, not the user_progress subcollection one
        // that precedes it and carries its own guard.
        const zeroWriteAt = fn.indexOf('progressPercent: 0', guardAt);

        expect(guardAt).toBeGreaterThan(-1);
        expect(fn).toContain('(await progressRef.get()).exists');
        expect(zeroWriteAt).toBeGreaterThan(guardAt);
    });

    it('no query anywhere looks for a field nothing writes', async () => {
        // The general form. A `.where` on a field no writer supplies always
        // returns empty — the class behind #118, #132 and #139 as well as this.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/academy/_ac_enrollment.ts'), 'utf-8');

        // resolvedUserId is written by nothing. It may now appear ONLY as the
        // deliberate legacy read — one for COURSE_PROGRESS and one for
        // COURSE_ENROLLMENTS, the two collections the bug wrote into. A third
        // would mean the pattern had spread again.
        const queries = [...src.matchAll(/\.where\("resolvedUserId"/g)];
        expect(queries.length).toBe(2);
    });
});

describe('a land listing its owner can see', () => {
    async function routeSource(): Promise<string> {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        return readFileSync(join(process.cwd(), 'src/app/api/farm-nation/create-listing/route.ts'), 'utf-8');
    }

    it('writes the fields the readers query', async () => {
        // farm-nation.ts queries ownerId for "my listings"; land-listings.ts and
        // farm-nation-admin.ts query status for browse and for the review queue.
        const src = await routeSource();
        const write = src.slice(src.indexOf('listingRef.set('));

        expect(write).toContain('ownerId:');
        expect(write).toContain('status:');
    });

    it('uses a status from the shared vocabulary', async () => {
        // land-listing-status.ts is the definition. `draft` is not in it.
        const src = await routeSource();
        const { PURCHASABLE_STATUSES } = await import('@/lib/land-listing-status');

        expect(src).toContain('status: "pending_verification"');
        // And not straight to purchasable — that would put a listing on sale
        // with no review, which is not this route's decision to take.
        for (const purchasable of PURCHASABLE_STATUSES) {
            expect(src).not.toContain(`status: "${purchasable}"`);
        }
    });

    it('enters the queue the admin screen actually reads', async () => {
        // The review queue counts by this exact value, so the listing has to
        // carry it to ever be verified.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const admin = readFileSync(join(process.cwd(), 'src/app/actions/farm-nation-admin/_fna_verifications.ts'), 'utf-8');

        expect(admin).toContain('where("status", "==", "pending_verification")');
        expect(await routeSource()).toContain('status: "pending_verification"');
    });
});
