/**
 * @jest-environment node
 */

/**
 *   #279 A SECOND enrollInCourseAction GRANTED PAID COURSES FOR FREE, AND THE
 *        SCAN THAT FOUND IT IS WHAT THIS FILE PINS.
 *
 *        Three findings in a row came out of one question — WHICH
 *        IMPLEMENTATION DOES THE PRODUCT ACTUALLY REACH?
 *
 *          #276  submitWithdrawalAction, defined twice. The modal calls the
 *                copy in platform.ts, which applied neither the minimum nor
 *                the membership check its three siblings applied.
 *          #277  approveAcademyApplicationAction, defined THREE times. The
 *                admin page calls the one in admin/_academy.ts — not the one
 *                the barrel comments call canonical and the suites exercise.
 *          #279  enrollInCourseAction, defined twice. Below.
 *
 *        Each time, the hardening pass enumerated the implementations it knew
 *        about and the UI-wired one was not among them. A hand-maintained list
 *        is how that keeps happening, so this is a DERIVED one: it scans for
 *        the duplicates itself and fails when a new one appears.
 *
 * WHAT #279 WAS
 * -------------
 * Two exports named enrollInCourseAction. The academy barrel exports the one in
 * academy/_ac_enrollment.ts, which both learner pages import. The other lived in
 * platform.ts with NO IMPORTER — but exported from "@/app/actions/platform", a
 * module the UI already imports for submitWithdrawalAction, under a name that
 * shadowed the correct action. An autocomplete pick from the wrong module was
 * all it took.
 *
 * The wired one checks three things: that the caller is enrolling themselves,
 * that the academy registration has not been DECIDED AGAINST — rejected,
 * suspended, revoked, the #207 vocabulary, which #210 added here so a rejected
 * applicant could not enrol their way back into the role — and
 * checkCourseAccess(userPlan, courseTier). The other asked for none of them:
 * any signed-in account, any courseId.
 *
 * ("pending" deliberately passes. A free-tier course is open to everybody, and
 * isDecidedAgainst exists precisely because "not approved" cannot tell a
 * rejection from a not-started application. Asserted below as written, not as
 * assumed — the first version of this test expected a pending registration to
 * be refused and was wrong about the rule.)
 *
 * AND IT WROTE THE DOCUMENT THE PAID FLOW OWNS. academy/_payment.ts writes
 * enrollments/{userId}_{courseId} as `status: "pending_payment"` with a Paystack
 * reference and a ₦1,000 minimum, and only the verified callback promotes it to
 * "active". platform.ts wrote THE SAME DOC ID straight to `status: "active"`
 * with no amount and no reference. Two writers of one document disagreeing
 * about what "active" means, one of them able to mint it for nothing.
 *
 * Removed rather than hardened — hardening it would mean reimplementing the
 * action that already exists and is wired — with a tombstone left in place, so
 * the next person looking for it is sent to the right one.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOTS = ['src/app/actions', 'src/app/api'];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith('.ts')) out.push(full);
    }
    return out;
}

function codeOnly(abs: string): string {
    return readFileSync(abs, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/**
 * Where each *Action name is DEFINED. Declarations only — a re-export from a
 * barrel is not a second implementation, and counting it as one would fill the
 * list with noise that hides the real duplicates.
 */
function definitionsByName(): Map<string, string[]> {
    const byName = new Map<string, string[]>();

    for (const root of ROOTS) {
        for (const file of walk(join(process.cwd(), root))) {
            const rel = file.slice(process.cwd().length + 1);
            const src = codeOnly(file);

            for (const m of src.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+(_?[A-Za-z0-9_]+Action)\b/gm)) {
                const name = m[1].replace(/^_/, '');
                byName.set(name, [...new Set([...(byName.get(name) ?? []), rel])]);
            }
            for (const m of src.matchAll(/^\s*export\s+const\s+([A-Za-z0-9_]+Action)\b/gm)) {
                // `export const x = withSafeAction("x", _x)` is the wrapper for a
                // declaration already counted above, in the same file, so the
                // de-dupe by path keeps it from doubling.
                byName.set(m[1], [...new Set([...(byName.get(m[1]) ?? []), rel])]);
            }
        }
    }

    return byName;
}

/**
 * The duplicates that exist and have been looked at. Each one is a name with
 * more than one implementation — which is not automatically a defect, but is
 * automatically a QUESTION: which of them does the product reach, and do they
 * agree?
 *
 * A name is on this list because that question has been ASKED, not because the
 * answer was reassuring. Three of them were defects and are recorded as such.
 */
const KNOWN_DUPLICATES: Record<string, number> = {
    // ── Answered, and the answer was a defect ──────────────────────────────
    submitWithdrawalAction: 2,             // #276 — the modal's door had neither guard
    approveAcademyApplicationAction: 3,    // #277 — the admin page's door reported
    rejectAcademyApplicationAction: 2,     //        success and wrote nothing

    // ── Answered, and the implementations agree or the second is unreachable ─
    createDisputeAction: 2,                // #108
    updateExportStatusAction: 2,           // #275 — both now use the shared rule
    getProductReviewsAction: 2,            // #47
    moderateReviewAction: 2,               // #124
    deleteResourceAction: 2,               // both require wave:manage_training, and
    updateResourceAction: 2,               // the wired one re-reads roles from the
                                           // database rather than trusting the JWT

    // ── Examined. Each of these eight was carried here as "not yet examined"
    //    for several passes; that note was itself the kind of stale statement
    //    this audit removes, so the question has now been asked of all of them
    //    and the answer written down. None is a defect. ────────────────────────
    //
    // The three WRITE pairs, which are where a wrong door costs something:
    createAnnouncementAction: 2,           // cms.ts is the wired one (admin/cms
                                           // page). admin-communications.ts's
                                           // copy has no caller and its own
                                           // header records that every row it
                                           // ever wrote was unreadable by the
                                           // only reader — already repaired.
    createExportWindowAction: 2,           // NOT one action twice: two entities
                                           // sharing a name. _ex_windows.ts
                                           // creates a SHIPMENT ("pending"),
                                           // export-aggregation.ts creates an
                                           // AGGREGATION ("open"). The split is
                                           // the subject of
                                           // export-window-status-vocabulary,
                                           // and merging them is a schema
                                           // decision, not an audit's.

    // The five READ pairs. For a reader the hazard is scope, not validation —
    // #31 and #95 are both "read somebody else's row" — so that is what was
    // checked, on BOTH sides of each pair, because both are exported server
    // actions and therefore both are endpoints whatever the UI picks:
    getAuditLogsAction: 2,                 // audit.ts is a legacy-format mapper
                                           // that gates on admin AND delegates
                                           // to audit-log-actions.ts, which
                                           // gates again. Double-gated.
    getBuyerOrdersAction: 2,               // both filter buyerId == session id
    getSellerOrdersAction: 2,              // both filter sellerIds
                                           // array-contains session id; the
                                           // UNWIRED one additionally requires
                                           // the seller role — stricter, not
                                           // weaker
    getDashboardStatsAction: 2,            // admin analytics vs the member
                                           // dashboard: different figures for
                                           // different audiences, each gated
                                           // for its own
    getPropertyByIdAction: 2,              // farm-nation Property vs
                                           // land-listings LandListing, two
                                           // shapes; the three farm-nation
                                           // screens all use land-listings. A
                                           // listing is public either way.
    getRecentActivityAction: 2,            // cooperative admin report vs member
                                           // dashboard feed
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#279 — one name, one implementation', () => {
    const defs = definitionsByName();
    const duplicates = [...defs.entries()]
        .filter(([, files]) => files.length > 1)
        .map(([name, files]) => [name, files.length] as const)
        .sort();

    it('the scan finds actions at all, so the checks below are not vacuous', () => {
        expect(defs.size).toBeGreaterThan(300);
    });

    it('NO ACTION NAME IS DEFINED IN MORE PLACES THAN IT WAS', () => {
        // The ratchet. A new duplicate — or an extra implementation of an
        // existing one — fails here, and whoever adds it has to answer the
        // question this file is about before adding to the list.
        const unexpected = duplicates
            .filter(([name, count]) => (KNOWN_DUPLICATES[name] ?? 0) < count)
            .map(([name, count]) => `${name}: ${count} (known ${KNOWN_DUPLICATES[name] ?? 0})`);

        expect(unexpected).toEqual([]);
    });

    it('and enrollInCourseAction is down to ONE', () => {
        // #279 itself. platform.ts carried a second one that granted a paid
        // course for free; it is gone, and this is what says so.
        expect(defs.get('enrollInCourseAction')).toHaveLength(1);
        expect(defs.get('enrollInCourseAction')![0])
            .toBe('src/app/actions/academy/_ac_enrollment.ts');
    });

    it('platform.ts exports no enrolment door at all', () => {
        // Stated against the file rather than the map, because the danger was
        // never that the action was wrong in isolation — it was that this
        // module is imported by UI components and the name shadowed the right
        // one.
        const src = codeOnly(join(process.cwd(), 'src/app/actions/platform.ts'));

        expect(src).not.toContain('enrollInCourseAction');
        expect(src).not.toContain('COLLECTIONS.ENROLLMENTS');
    });

    it('and the tombstone survives, so the removal is not silent', () => {
        // A deleted export that leaves no trace reads as "this never existed".
        const raw = readFileSync(join(process.cwd(), 'src/app/actions/platform.ts'), 'utf-8');

        expect(raw).toContain('#279');
        expect(raw).toContain('academy/_ac_enrollment.ts');
    });

    it('every known duplicate still exists, so the list is not stale', () => {
        // The other half of a ratchet. A name that has been unified should come
        // OFF this list rather than sit on it claiming a duplicate that is gone
        // — that is how the hand-written door lists in #276 went wrong.
        const stale = Object.keys(KNOWN_DUPLICATES)
            .filter((name) => (defs.get(name)?.length ?? 0) < 2);

        expect(stale).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#279 — the enrolment that remains still applies its three rules', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    /**
     * Executed rather than read. The removal only helps if the surviving door
     * is the strict one — a source-only check would pass just as well against
     * the pair the wrong way round.
     */
    async function enrol(opts: {
        callerId?: string;
        academy?: Record<string, unknown>;
        courseTier?: string;
    }) {
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({
                session: { user: { id: 'learner-1', email: 'l@e.test', roles: ['academy_participant'] } },
                error: null,
            }),
        }));

        const { installFakeDb } = await import('@/lib/testing/fake-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const store = installFakeDb();

        store.seed(COLLECTIONS.USERS, 'learner-1', {
            uid: 'learner-1',
            email: 'l@e.test',
            serviceRegistrations: { academy: opts.academy ?? { status: 'approved', plan: 'premium' } },
        });
        // The OTHER user gets a complete, enrollable profile on purpose.
        // Without it, "refuses enrolling somebody else" passed for the wrong
        // reason: with the ownership guard disabled the action still failed, on
        // "User not found" from the missing row rather than on the guard. That
        // mutant survived until this row was seeded.
        store.seed(COLLECTIONS.USERS, 'another-user', {
            uid: 'another-user',
            email: 'other@e.test',
            serviceRegistrations: { academy: { status: 'approved', plan: 'premium' } },
        });
        store.seed(COLLECTIONS.ACADEMY_COURSES, 'c1', {
            title: 'A Course',
            tier: opts.courseTier ?? 'free',
        });

        const { enrollInCourseAction } = await import('@/app/actions/academy/_ac_enrollment');
        return (enrollInCourseAction as any)(opts.callerId ?? 'learner-1', 'c1');
    }

    it('REFUSES ENROLLING SOMEBODY ELSE', async () => {
        const res: any = await enrol({ callerId: 'another-user' });

        // The MESSAGE, not just failure: the other user is fully enrollable
        // above, so "Unauthorized" is the only refusal the ownership guard can
        // produce and any other one means this passed by accident.
        expect(res.success).toBe(false);
        expect(String(res.error)).toBe('Unauthorized');
    });

    it('REFUSES A REGISTRATION THAT WAS DECIDED AGAINST', async () => {
        // #210's rule: revoking the role on rejection means nothing if an
        // unrelated action hands it back. The removed door had no notion of it.
        for (const status of ['rejected', 'suspended', 'revoked']) {
            const res: any = await enrol({ academy: { status, plan: 'premium' } });
            expect({ status, ok: res.success }).toEqual({ status, ok: false });
        }
    });

    it('and a PENDING one still enrols, which is the rule as written', () => {
        // Not an oversight. isDecidedAgainst exists because "not approved"
        // cannot distinguish a rejection from a not-yet-started application,
        // and a free-tier course is open to everybody either way. Pinned so the
        // distinction is not "tightened" away by somebody reading the guard as
        // an approval check — which is exactly the mistake this test made on
        // its first run.
        return enrol({ academy: { status: 'pending', plan: 'premium' } })
            .then((res: any) => expect(res.success).toBe(true));
    });

    it('REFUSES A COURSE ABOVE THE LEARNER PLAN', async () => {
        const res: any = await enrol({
            academy: { status: 'approved', plan: 'free' },
            courseTier: 'premium',
        });
        expect(res.success).toBe(false);
    });

    it('and still enrols an approved learner in a course they may take', async () => {
        // Vacuity guard: a door that refused everything would close the academy.
        const res: any = await enrol({});
        expect(res.success).toBe(true);
    });
});
