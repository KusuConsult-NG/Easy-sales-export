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

    /**
     * Every lead this scanner produces, READ, with a verdict — #670.
     *
     *   This was `expect(findings.length).toBeLessThan(30)`, and the scanner
     *   reports ten. So TWENTY NEW DEFECTS COULD APPEAR AND THIS TEST WOULD
     *   STILL PASS. A cap on a count is not a ratchet: it is the same shape as
     *   #666's "35 of 45" and #658's unactionable warning — a number that says
     *   something might be wrong and never which thing.
     *
     *   All ten were read. Not one is an unaddressed defect, and three of them
     *   are a FIX being reported as the defect it fixed. Each is listed with the
     *   reason it is not acted on, so an eleventh fails this test instead of
     *   hiding under a cap.
     *
     *   Keyed WITHOUT the line number: a writer that moves down a file has not
     *   changed, and a list that broke on every unrelated edit above it would be
     *   deleted within a week.
     */
    const READ_AND_ACCEPTED: Record<string, string> = {
        //   THE ACADEMY RENAME, and the scanner is reporting the repair. Writers
        //   correctly write `userId` now; readers query the legacy
        //   `resolvedUserId` AS WELL so rows written while the name was wrong are
        //   still found. Writing it again would recreate the defect — see the
        //   three tests directly below this block.
        'COURSE_ENROLLMENTS | READER-EXPECTS src/app/actions/academy/_ac_enrollment.ts autoEnrollPaidUser never writes resolvedUserId — queried by readers':
            'the legacy read is deliberate; writing it again recreates the defect it recovers from',
        'COURSE_ENROLLMENTS | READER-EXPECTS src/app/actions/course-actions.ts enrollmentRef never writes resolvedUserId — queried by readers':
            'same — the field is read for recovery only',
        'COURSE_ENROLLMENTS | READER-EXPECTS src/lib/academy-course-progress.ts ensureCourseEnrolmentRecord never writes resolvedUserId — queried by readers':
            'same — the field is read for recovery only',

        //   A field stamped when a release is REQUESTED cannot be written by the
        //   site that creates the escrow.
        'ESCROW_TRANSACTIONS | READER-EXPECTS src/app/actions/marketplace/_payment_orders.ts _initializeOrderPaymentAction never writes releaseRequestedAt — queried by readers':
            'set later by the release-request path; a creation site has nothing to put there',
        'ESCROW_TRANSACTIONS | READER-EXPECTS src/infrastructure/payments/service.ts result never writes releaseRequestedAt — queried by readers':
            'same — written when a release is requested, not when the escrow is created',

        'NOTIFICATIONS | DIVERGENT-KEYS src/app/actions/marketplace/_quotes.ts _submitQuoteRequestAction omits linkText':
            'the link label falls back to a default; cosmetic, and the row is not invisible',

        //   These are UPDATES to an existing user document, not creates. A seller
        //   approval has no business restating somebody's name.
        'USERS | READER-EXPECTS src/app/actions/wave/_wv_admin_applications.ts _approveWaveApplicationAction never writes firstName, lastName, phone, phoneNumber, sellerVerificationStatus, updatedAt — queried by readers':
            'an update, not a create — the profile fields already exist on the row',
        'USERS | READER-EXPECTS src/app/api/admin/marketplace/approve-seller/route.ts POST never writes firstName, lastName, phone, phoneNumber — queried by readers':
            'an update, not a create',

        //   #669 territory. The WAVE earnings credit moves the balance with
        //   FieldValue.increment, which RETURNS NO BALANCE — so a
        //   balanceBefore/balanceAfter pair could only be derived from a separate
        //   read, and a read-derived trail is wrong under concurrency. A wrong
        //   balance trail on a money ledger is worse than an absent one, and
        //   WalletClient already guards on `!== undefined`. Recorded, not fixed.
        'WALLET_TRANSACTIONS | DIVERGENT-KEYS src/app/actions/order-management.ts result omits id, balanceBefore, balanceAfter':
            'credited by FieldValue.increment, which returns no balance; a derived trail would be racy',
        'WALLET_TRANSACTIONS | DIVERGENT-KEYS src/infrastructure/payments/service.ts result omits reference':
            'the purchase leg carries orderId instead, and nothing queries this collection by reference',
    };

    /** The finding, with its line number removed. */
    const key = (collection: string, finding: string) =>
        `${collection} | ${finding.replace(/:\d+ /, ' ')}`;

    /**
     * The two comparisons, as FUNCTIONS.
     *
     *   A mutation run turned `expect({ unread }).toEqual({ unread: [] })` into
     *   `expect(true).toBe(true)` and nothing noticed — which is the
     *   delete-an-assertion mutant this audit has relearned six times, and the
     *   repair is always the same one: make the decision a named function and
     *   ask it questions with known answers. Then the LOGIC is verified even
     *   though the assertion that uses it is, like every assertion, deletable.
     */
    const unreadIn = (live: string[], accepted: Record<string, string>) =>
        live.filter((k) => !(k in accepted));

    const staleIn = (live: string[], accepted: Record<string, string>) =>
        Object.keys(accepted).filter((k) => !live.includes(k));

    it('THE COMPARISON ITSELF ANSWERS KNOWN QUESTIONS', () => {
        expect(unreadIn(['a', 'b'], { a: 'read' })).toEqual(['b']);
        expect(unreadIn(['a'], { a: 'read' })).toEqual([]);
        //   An empty tree is not a clean tree: nothing unread, and every
        //   accepted entry stale.
        expect(unreadIn([], { a: 'read' })).toEqual([]);
        expect(staleIn([], { a: 'read' })).toEqual(['a']);
        expect(staleIn(['a'], { a: 'read' })).toEqual([]);
    });

    it('EVERY FINDING IS ONE THAT HAS BEEN READ', () => {
        /*
         *   THE ratchet, replacing a cap that left room for twenty unread
         *   defects. A new finding fails here and has to be read and given a
         *   verdict — which is the only thing that makes a lead list worth
         *   generating.
         */
        const live = reportByCollection()
            .flatMap((r) => r.findings.map((f: string) => key(r.collection, f)));

        expect({ unread: unreadIn(live, READ_AND_ACCEPTED) }).toEqual({ unread: [] });
    });

    it('AND EVERY ACCEPTED ENTRY IS STILL A FINDING', () => {
        /*
         *   The other half. An entry for a lead the scanner no longer produces
         *   is an exemption that has stopped exempting anything and started
         *   hiding the next one — the same rule the public-route list in
         *   every-api-route-has-a-door lives under.
         */
        const live = reportByCollection()
            .flatMap((r) => r.findings.map((f: string) => key(r.collection, f)));

        expect({ stale: staleIn(live, READ_AND_ACCEPTED) }).toEqual({ stale: [] });
    });

    it('AND THE SCANNER IS STILL LOOKING AT THE WHOLE TREE', () => {
        //   A positive control on both lines above: a scanner that found
        //   nothing would satisfy them and report a clean codebase for ever.
        expect(reportByCollection().flatMap((r) => r.findings).length).toBeGreaterThanOrEqual(10);
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
        // The review queue selects on this value, so the listing has to carry it
        // to ever be verified.
        //
        // The assertion moved from the literal to the shared set. The queue used
        // to query `status == "pending_verification"` and now queries
        // `status in AWAITING_REVIEW_STATUSES` — because it was ALSO showing
        // inspection_scheduled listings under its pending tab while the
        // dashboards counted pending_verification alone. Pinning the literal here
        // pinned half of that disagreement.
        //
        // The property that matters is unchanged and is now checked directly:
        // whatever status this route writes must be in the set the queue reads.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const admin = readFileSync(join(process.cwd(), 'src/app/actions/farm-nation-admin/_fna_verifications.ts'), 'utf-8');
        const { AWAITING_REVIEW_STATUSES } = await import('@/lib/land-listing-status');

        expect(admin).toContain('"status", "in", [...AWAITING_REVIEW_STATUSES]');
        expect(await routeSource()).toContain('status: "pending_verification"');
        expect(AWAITING_REVIEW_STATUSES).toContain('pending_verification');
    });
});
