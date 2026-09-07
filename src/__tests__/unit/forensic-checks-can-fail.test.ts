/**
 * @jest-environment node
 */

/**
 *   #331 TWO OF THE EIGHT FORENSIC CHECKS COULD NEVER FIND ANYTHING, AND BOTH
 *        REPORTED "pass" PLUS A SCAN COUNT THEY HAD NOT PERFORMED.
 *
 *        Academy — "Enrollment Audit (Paid vs Proof)"
 *
 *            db.collection(COURSE_ENROLLMENTS)
 *              .where("paymentStatus", "==", "paid").limit(50)
 *            ...
 *            if (enrollment.amountPaid > 0 && !enrollment.paymentReference)
 *
 *        course_enrollments has exactly two writers — course-actions.ts
 *        (_enrollInCourseAction) and academy/_ac_enrollment.ts
 *        (autoEnrollPaidUser) — and both write the same six fields: userId,
 *        courseId, enrolledAt, status, createdAt, updatedAt. Not one of
 *        paymentStatus, amountPaid or paymentReference is written by anything
 *        in the codebase. The query matched nothing, the loop never ran, and
 *        the check reported:
 *
 *            status: "pass"
 *            "Scanned 50 paid enrollments. Found 0 with missing refs."
 *
 *        Three false statements: it scanned no rows, not 50; it found nothing
 *        because it could not look; and "pass" reads as "no free riders".
 *
 *        Farm Nation — "Verification Fraud (Badge vs Doc)"
 *
 *            .where("farmNationProfile.isVerified", "==", true)
 *            ...
 *            db.collection(LAND_VERIFICATIONS).where("status","==","verified")
 *
 *        `farmNationProfile` appears in exactly ONE place in this repository:
 *        that query. `land_verifications` appears in exactly two: its name in
 *        COLLECTIONS, and that query. Nothing writes either. Same fabricated
 *        "Scanned 50", same unearned pass.
 *
 *        The badge that does exist is `isVerified` on the user, set by
 *        _approveFarmerAction alongside
 *        serviceRegistrations.farmNation.status = "approved" — so a badge
 *        without that approval is the anomaly the check was reaching for.
 *
 * These tests EXECUTE the scan against a seeded world, because the defect was
 * precisely that reading the code's intent tells you nothing about whether the
 * query can match.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const ADMIN = 'admin-1';
const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

function setSession(uid: string, roles: string[]) {
    (global as any).mockRequireSession.mockResolvedValue({
        session: { user: { id: uid, roles, email: 'a@b.c' } },
        response: null,
    });
}

/**
 * The world each check reads. Everything the scan touches that is not named
 * here answers empty, so one check can be exercised without seeding the
 * other seven.
 */
function setWorld(opts: {
    users?: any[];
    enrolments?: any[];
    courses?: Record<string, any>;
    usersById?: Record<string, any>;
    /**
     *   #486 the farm nation check compares the user's registration against
     *   the AUTHORITATIVE application record, so the world has to hold both.
     *   Under the old check it read one document and compared it to a flag
     *   thirteen unrelated paths write, which needed no second collection —
     *   and could not fail correctly.
     */
    farmApplications?: any[];
}) {
    const { users = [], enrolments = [], courses = {}, usersById = {}, farmApplications = [] } = opts;

    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        const empty = { exists: false, empty: true, size: 0, docs: [], data: () => ({}) };

        if (idOrCollection === 'users') {
            // Both the farm-nation badge query and the academy learner
            // hydration read `users`. Seeded rows serve whichever asked.
            const docs = [
                ...users.map((u) => ({ id: u.id, data: () => u.data })),
                ...Object.entries(usersById).map(([id, data]) => ({ id, data: () => data })),
            ];
            return Promise.resolve({ exists: false, empty: docs.length === 0, size: docs.length, docs, data: () => ({}) });
        }
        if (idOrCollection === 'farm_nation_applications') {
            return Promise.resolve({
                exists: false, empty: farmApplications.length === 0, size: farmApplications.length,
                docs: farmApplications.map((a) => ({ id: a.id, data: () => a.data })),
                data: () => ({}),
            });
        }
        if (idOrCollection === 'course_enrollments') {
            return Promise.resolve({
                exists: false, empty: enrolments.length === 0, size: enrolments.length,
                docs: enrolments.map((e) => ({ id: e.id, data: () => e.data })),
                data: () => ({}),
            });
        }
        if (idOrCollection === 'academy_courses') {
            const docs = Object.entries(courses).map(([id, data]) => ({ id, data: () => data }));
            return Promise.resolve({ exists: false, empty: docs.length === 0, size: docs.length, docs, data: () => ({}) });
        }
        return Promise.resolve(empty);
    });

    (global as any).mockFirestoreTxGet.mockImplementation(() =>
        Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => ({}) }));
}

async function scan() {
    const { runForensicScanAction } = await import('@/app/actions/forensics');
    return runForensicScanAction();
}

function check(result: any, name: string) {
    const results = result?.data?.results ?? result?.results ?? [];
    return results.find((r: any) => r.check === name);
}

const ACADEMY = 'Enrollment Audit (Access vs Plan)';
const FARM = 'Approval Drift (User Record vs Application)';

beforeEach(() => {
    jest.clearAllMocks();
    setSession(ADMIN, ['admin']);
    (global as any).adminAuthListUsers?.mockReset?.();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#331 — the academy check can now fail', () => {
    it('FINDS A LEARNER ON A COURSE THEIR PLAN DOES NOT OPEN', () => {
        // A foundation learner enrolled in an elite course. checkCourseAccess
        // is the platform's own rule, and it says no.
        setWorld({
            enrolments: [{ id: 'enr-1', data: { userId: 'u1', courseId: 'c-elite', status: 'active' } }],
            courses: { 'c-elite': { tier: 'elite' } },
            usersById: { u1: { serviceRegistrations: { academy: { plan: 'foundation' } } } },
        });

        return scan().then((res) => {
            const c = check(res, ACADEMY);
            expect(c).toBeDefined();
            expect(c.status).toBe('warning');
            expect(c.affectedIds.some((s: string) => s.startsWith('enr-1'))).toBe(true);
        });
    });

    it('passes a learner whose plan does open the course', async () => {
        setWorld({
            enrolments: [{ id: 'enr-2', data: { userId: 'u2', courseId: 'c-found', status: 'active' } }],
            courses: { 'c-found': { tier: 'foundation' } },
            usersById: { u2: { serviceRegistrations: { academy: { plan: 'elite' } } } },
        });

        const c = check(await scan(), ACADEMY);

        expect(c.status).toBe('pass');
        expect(c.affectedIds).toEqual([]);
    });

    it('SEPARATES "could not resolve" FROM "no finding"', async () => {
        // A course that no longer exists is a gap in the records, not evidence
        // about the learner — the same distinction the WAVE age check draws
        // for an absent date of birth.
        setWorld({
            enrolments: [{ id: 'enr-3', data: { userId: 'u3', courseId: 'c-gone', status: 'active' } }],
            courses: {},
            usersById: { u3: { serviceRegistrations: { academy: { plan: 'foundation' } } } },
        });

        const c = check(await scan(), ACADEMY);

        expect(c.affectedIds.some((s: string) => s.includes('course not found'))).toBe(true);
        expect(c.details).toMatch(/could not be resolved/);
        // Unresolved is not counted as a free ride.
        expect(c.details).toMatch(/Found 0 on a course their plan does not open/);
    });

    it('REPORTS THE COUNT IT ACTUALLY SCANNED, not a literal 50', async () => {
        setWorld({
            enrolments: [
                { id: 'e1', data: { userId: 'u1', courseId: 'c1', status: 'active' } },
                { id: 'e2', data: { userId: 'u1', courseId: 'c1', status: 'active' } },
            ],
            courses: { c1: { tier: 'foundation' } },
            usersById: { u1: { serviceRegistrations: { academy: { plan: 'elite' } } } },
        });

        const c = check(await scan(), ACADEMY);

        expect(c.details).toMatch(/Scanned 2 active enrolments/);
        expect(c.details).not.toMatch(/Scanned 50/);
    });

    it('says so when there is nothing to check, instead of implying it looked', async () => {
        setWorld({ enrolments: [] });

        const c = check(await scan(), ACADEMY);

        expect(c.details).toBe('No active enrolments found to check.');
        expect(c.details).not.toMatch(/Scanned 50/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#486 — the farm nation check asks a question it can be right about', () => {
    /**
     *   THESE CASES USED TO SEED `isVerified: true` AND EXPECT A FAILURE.
     *
     *   They were correct about the code. The code was asking the wrong
     *   question: `isVerified` is written by thirteen paths across every module,
     *   including payment fulfilment, so "verified badge, registration pending"
     *   is the ordinary state of a farmer who also joined the cooperative. Both
     *   of the owner's two production findings were exactly that, and this
     *   suite was proving the false positive worked.
     *
     *   What it compares now is the user's registration against the
     *   authoritative application record — two documents _approveFarmerAction
     *   writes in ONE transaction, so disagreement means an approval landed by
     *   halves.
     */
    it('FINDS A USER APPROVED ON THEIR RECORD AND NOT ON THE APPLICATION', () => {
        //   THE test. This is the half-applied approval: the member is told
        //   they are approved and the queue still holds them as pending.
        setWorld({
            users: [{
                id: 'f1',
                data: { roles: ['farmer'], serviceRegistrations: { farmNation: { status: 'approved' } } },
            }],
            farmApplications: [{ id: 'a1', data: { userId: 'f1', status: 'pending' } }],
        });

        return scan().then((res) => {
            const c = check(res, FARM);
            expect(c).toBeDefined();
            expect(c.status).toBe('fail');
            expect(c.affectedIds.some((s: string) => s.startsWith('f1'))).toBe(true);
        });
    });

    it('AND THE OTHER DIRECTION — approved application, user record not updated', async () => {
        //   The one that strands a member: an admin approved them and the
        //   record the app reads still says pending, so they see a waiting room
        //   for a decision that was made.
        setWorld({
            users: [{
                id: 'f2',
                data: { roles: ['farmer'], serviceRegistrations: { farmNation: { status: 'pending' } } },
            }],
            farmApplications: [{ id: 'a2', data: { userId: 'f2', status: 'approved' } }],
        });

        const c = check(await scan(), FARM);

        expect(c.status).toBe('fail');
        expect(c.affectedIds.some((s: string) => s.startsWith('f2'))).toBe(true);
    });

    it('AND AN APPROVED USER WITH NO APPLICATION AT ALL', async () => {
        setWorld({
            users: [{
                id: 'f3',
                data: { roles: ['farmer'], serviceRegistrations: { farmNation: { status: 'approved' } } },
            }],
            farmApplications: [],
        });

        const c = check(await scan(), FARM);

        expect(c.status).toBe('fail');
        expect(c.affectedIds.some((s: string) => s.includes('no application record'))).toBe(true);
    });

    it('A PENDING APPLICANT IS NOT A FINDING — the false positive this replaces', async () => {
        //   The assertion that matters most to the owner. Under the old check,
        //   this user failed if any module had ever set isVerified. They are a
        //   farmer whose application is pending, and the two records agree.
        setWorld({
            users: [{
                id: 'f4',
                data: {
                    isVerified: true,   // set by the cooperative, or a payment
                    roles: ['farmer'],
                    serviceRegistrations: { farmNation: { status: 'pending' } },
                },
            }],
            farmApplications: [{ id: 'a4', data: { userId: 'f4', status: 'pending' } }],
        });

        const c = check(await scan(), FARM);

        expect(c.status).toBe('pass');
        expect(c.affectedIds).toEqual([]);
    });

    it('and a farmer with no registration and no application is not this check\'s business', async () => {
        //   A legacy import or an admin role grant. Reporting them would bury
        //   the real findings under the population, which is #475's lesson.
        setWorld({ users: [{ id: 'f5', data: { roles: ['farmer'] } }], farmApplications: [] });

        const c = check(await scan(), FARM);

        expect(c.status).toBe('pass');
    });

    it('REPORTS THE COUNT IT ACTUALLY SCANNED', async () => {
        setWorld({
            users: [
                { id: 'f6', data: { roles: ['farmer'], serviceRegistrations: { farmNation: { status: 'approved' } } } },
                { id: 'f7', data: { roles: ['farmer'], serviceRegistrations: { farmNation: { status: 'approved' } } } },
            ],
            farmApplications: [
                { id: 'a6', data: { userId: 'f6', status: 'approved' } },
                { id: 'a7', data: { userId: 'f7', status: 'approved' } },
            ],
        });

        const c = check(await scan(), FARM);

        expect(c.details).toMatch(/Scanned 2 accounts holding the farmer role/);
        expect(c.details).not.toMatch(/Scanned 50/);
    });

    it('says so when there are no farmers', async () => {
        setWorld({ users: [] });

        const c = check(await scan(), FARM);

        expect(c.details).toBe('No farmers found to check.');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#490 — the duplicate-profile check counts what is there', () => {
    const DUPES = 'Duplicate Profiles (One Address, Several Accounts)';

    it('REPORTS AN ADDRESS HOLDING SEVERAL PROFILES', async () => {
        //   Executed rather than grepped: a source assertion that the check
        //   EXISTS stayed true for a version whose status was hard-coded to
        //   "pass", and that mutant survived.
        setWorld({
            users: [
                { id: 'u1', data: { email: 'ada@example.com' } },
                { id: 'u2', data: { email: 'Ada@Example.COM' } },
                { id: 'u3', data: { email: 'solo@example.com' } },
            ],
        });

        const c = check(await scan(), DUPES);

        expect(c.status).toBe('warning');
        expect(c.affectedIds).toHaveLength(1);
        expect(c.affectedIds[0]).toMatch(/2 profiles/);
        //   Case and surrounding space are not two different people (#476).
        expect(c.affectedIds[0]).toMatch(/u1/);
        expect(c.affectedIds[0]).toMatch(/u2/);
    });

    it('AND PASSES WHEN EVERY ADDRESS HOLDS ONE', async () => {
        //   The other direction, without which "warning" could be constant.
        setWorld({
            users: [
                { id: 'u1', data: { email: 'ada@example.com' } },
                { id: 'u2', data: { email: 'bola@example.com' } },
            ],
        });

        const c = check(await scan(), DUPES);

        expect(c.status).toBe('pass');
        expect(c.affectedIds).toEqual([]);
    });

    it('AND BLANK ADDRESSES ARE NOT ONE 49-WAY DUPLICATE', async () => {
        //   #479: a blank email is not an identity. Grouping on it would report
        //   the email-less profiles as a single enormous finding — the loudest
        //   possible way to say nothing. They have their own check.
        setWorld({
            users: [
                { id: 'b1', data: { email: '' } },
                { id: 'b2', data: { email: null } },
                { id: 'b3', data: {} },
                { id: 'b4', data: { email: '   ' } },
            ],
        });

        const c = check(await scan(), DUPES);

        expect(c.status).toBe('pass');
    });

    it('and the address is masked on the report', async () => {
        //   A forensic report is the thing most likely to be screenshotted into
        //   a chat. The profile ids beside it are what an operator acts on.
        setWorld({
            users: [
                { id: 'u1', data: { email: 'lubashehu369@gmail.com' } },
                { id: 'u2', data: { email: 'lubashehu369@gmail.com' } },
            ],
        });

        const c = check(await scan(), DUPES);

        expect(c.affectedIds[0]).not.toContain('lubashehu369');
        expect(c.affectedIds[0]).toContain('@gmail.com');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#331 — the fields that made both checks impossible are gone', () => {
    const src = source('src/app/actions/forensics.ts');

    it('NOTHING QUERIES farmNationProfile — a path with no writer', () => {
        expect(src).not.toMatch(/farmNationProfile/);
    });

    it('and land_verifications, a collection with no writer, is not consulted', () => {
        expect(src).not.toMatch(/LAND_VERIFICATIONS/);
    });

    it('and course_enrollments is not queried on paymentStatus', () => {
        expect(src).not.toMatch(/"paymentStatus", "==", "paid"/);
        expect(src).not.toMatch(/amountPaid/);
        expect(src).not.toMatch(/paymentReference/);
    });

    it('POSITIVE CONTROL: the patterns above match the code they were written for', () => {
        // The three assertions above are `not.toMatch`, which passes trivially
        // if a pattern is malformed and matches nothing. Each is checked here
        // against the line it came from, quoted verbatim from the revision
        // this finding removed.
        //
        // Deliberately a fixture and NOT `git show HEAD:…`, which is what this
        // test did first: before the commit HEAD was the old revision and it
        // passed; after the commit HEAD is the new one and it failed. A test
        // whose subject moves with the branch can only be right once. The
        // pre-push hook caught it, which is what that hook is for.
        const REMOVED = `
            .where("farmNationProfile.isVerified", "==", true)
            db.collection(COLLECTIONS.LAND_VERIFICATIONS)
            .where("paymentStatus", "==", "paid")
            if (enrollment.amountPaid > 0 && !enrollment.paymentReference) {
            details: \`Scanned 50 paid enrollments. Found \${freeRideIds.length} with missing refs.\`,
        `;

        expect(REMOVED).toMatch(/farmNationProfile/);
        expect(REMOVED).toMatch(/LAND_VERIFICATIONS/);
        expect(REMOVED).toMatch(/"paymentStatus", "==", "paid"/);
        expect(REMOVED).toMatch(/amountPaid/);
        expect(REMOVED).toMatch(/paymentReference/);
        expect(REMOVED).toMatch(/Scanned 50/);
    });

    it('NO CHECK STATES A SCAN COUNT IT DID NOT PERFORM', () => {
        // "Scanned 50 …" was printed by two checks regardless of how many rows
        // came back — including zero.
        expect(src).not.toMatch(/Scanned 50/);
    });

    it('the academy check uses the platform\'s own access rule', () => {
        // Not a fourth hand-written copy of "which tiers does this plan open".
        expect(src).toMatch(/checkCourseAccess\(/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#331 — a check that cannot run must not report a pass', () => {
    it('the result type admits "inconclusive"', () => {
        const src = source('src/app/actions/forensics.ts');
        expect(src).toMatch(/"pass" \| "fail" \| "warning" \| "inconclusive"/);
    });

    it('and the file records WHY the false passes survived so long', () => {
        //   #266 THE OWNER DECISION WAS TAKEN: THE SCREEN IS BUILT.
        //
        //        This used to assert "has no caller in application code" and
        //        that nothing imported the module — the reason the false passes
        //        went unnoticed. Both are now false, deliberately: dropping
        //        eight repaired integrity checks would have been the wrong half
        //        of "build it or drop it".
        //
        //        The history is still recorded, because it is the explanation
        //        for how a check that could never fail lived here for so long.
        const raw = readFileSync('src/app/actions/forensics.ts', 'utf-8');
        expect(raw).toMatch(/NOBODY CALLED THIS FILE — UNTIL #266/);
        expect(raw).toMatch(/THE SCREEN IS BUILT/);
    });

    it('and the ONE production caller is that screen', () => {
        // Counted rather than "at least one". A second importer appearing is
        // worth looking at: this action is platform-admin-only and reads across
        // eight collections, so it should have exactly one way in.
        const { execSync } = require('child_process');
        const hits = execSync(
            "grep -rln 'actions/forensics' src --include=*.ts --include=*.tsx || true",
            { encoding: 'utf-8' },
        )
            .split('\n')
            .filter(Boolean)
            .filter((f: string) => !f.includes('__tests__') && f !== 'src/app/actions/forensics.ts');

        expect(hits).toEqual(['src/app/admin/forensics/page.tsx']);
    });

    it('and it is still gated on isPlatformAdmin, not on being any admin', () => {
        // Building a way in must not have widened the audience. The admin
        // layout admits all ten admin roles; this action admits two.
        const src = source('src/app/actions/forensics.ts');

        expect(src).toContain('if (!isPlatformAdmin(session?.user?.roles))');
        expect(src).toContain('Unauthorized: Admin access required');
    });

    it('and the scan still writes nothing, which is what makes it safe to expose', () => {
        // The measurement behind #266's decision. Every mutation-looking call
        // in the file is a JavaScript Set or Map; a document write would show
        // up as one of these on a `db` reference.
        const src = source('src/app/actions/forensics.ts');

        expect(src).not.toMatch(/\bRef\.(set|update|delete)\s*\(/);
        expect(src).not.toMatch(/\.collection\([^)]*\)\.(add|doc)\([^)]*\)\.(set|update|delete)\s*\(/);
        expect(src).not.toMatch(/FieldValue\./);
        expect(src).not.toMatch(/db\.batch\(/);
    });
});
