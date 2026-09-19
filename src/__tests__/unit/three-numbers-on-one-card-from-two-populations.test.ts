/**
 * @jest-environment node
 */

/**
 *   #905 THE COOPERATIVE CARD ASKED FOR ARITHMETIC THAT CANNOT WORK.
 *
 *   THE OWNER, reading /admin/cooperatives/members:
 *
 *       Pending 98        Approved 1742
 *       Total Paid Members 1731     Out of 3110 applications
 *       Unpaid Members 109
 *
 *   98 + 1742 = 1840. 1731 + 109 = 1840. Neither is 3110, and 1,270
 *   applicants sat in no bucket at all. Their words: "these figures too are
 *   not correct".
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 *   #835 replaced the headline total with the APPLICANT REGISTER's count —
 *   `serviceRegistrations.cooperative.status` on the user, which every enrolment
 *   path maintains — because COOPERATIVE_MEMBERS holds a row only for the route
 *   that writes one. That substitution was right.
 *
 *   It reached the headline and not the breakdown. `pendingCount`,
 *   `approvedCount` and the subtraction behind `unpaidMembers` all kept reading
 *   the membership table, so one card carried three numbers from two
 *   populations and presented them as a breakdown of each other.
 *
 * ── AND EVERY OTHER MODULE ALREADY DID IT WHOLE ─────────────────────────────
 *
 *   The owner's framing was exactly right — "just like WAVE was fixed all the
 *   other modules should be fixed". wave/compliance, admin/_exports and
 *   academy/_ac_admin_applications each switch total, pending, approved AND
 *   rejected together on one `useRegister` flag. Farm Nation reports only a
 *   total and has nothing to contradict. Cooperative was the one module where
 *   the rule reached the headline and stopped.
 *
 *   THE ARITHMETIC IS THE TEST. Not "it calls the register" — that was true
 *   before and the numbers were still wrong.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
    isAdmin: () => true,
}));

const mockAdminScope = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/cooperative-admin-scope', () => ({
    getAdminScope: (...a: any[]) => mockAdminScope(...a),
}));

const mockMetrics = jest.fn() as jest.Mock<any>;
jest.mock('@/services', () => ({
    userMetricsService: { getCooperativeMemberMetrics: (...a: any[]) => mockMetrics(...a) },
}));

const mockCountApplicants = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/module-applicant-count', () => {
    const actual = jest.requireActual('@/lib/module-applicant-count') as any;
    return { ...actual, countModuleApplicants: (...a: any[]) => mockCountApplicants(...a) };
});

//   The money half of the action reads collections this test does not care
//   about; an empty snapshot for all of them leaves the membership figures —
//   which is what this file is about — untouched.
jest.mock('@/lib/supabase-db', () => {
    const empty = { docs: [], empty: true, size: 0, truncated: false };
    const q: any = {
        where: () => q, select: () => q, limit: () => q, orderBy: () => q,
        all: () => q, get: async () => empty,
        aggregate: () => ({ get: async () => ({ data: () => ({ count: 0, total: 0 }) }) }),
    };
    return { supabaseDb: { collection: () => q }, getAdminDb: () => ({ collection: () => q }) };
});

/** The production shape the owner photographed. */
const REPORTED = {
    registerTotal: 3110,
    registerPending: 180,
    registerApproved: 2930,
    membershipRows: 1840,
    detailPending: 98,
    detailApproved: 1742,
    paid: 1731,
};

const stats = async () => {
    const { getCooperativeStatsAction } = await import('@/app/actions/cooperative/_coop_admin_reports');
    const res = await getCooperativeStatsAction() as any;
    return res.data.stats;
};

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireSession.mockResolvedValue({
        session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'a@e.com' } }, error: null,
    });
    mockAdminScope.mockResolvedValue(null);   // platform-wide, where #835 applies
    mockMetrics.mockResolvedValue({
        totalApplications: REPORTED.membershipRows,
        paidMembersCount: REPORTED.paid,
        //   1840 − 1731 = 109, the number on the card.
        unpaidMembers: REPORTED.membershipRows - REPORTED.paid,
        pendingCount: REPORTED.detailPending,
        approvedCount: REPORTED.detailApproved,
        suspendedCount: 0,
        orphanedPaymentsCount: 0,
    });
    mockCountApplicants.mockResolvedValue({
        counted: true,
        total: REPORTED.registerTotal,
        pending: REPORTED.registerPending,
        approved: REPORTED.registerApproved,
        rejected: 0, revisionRequired: 0, other: 0,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#905 — the card adds up', () => {
    it('THE REPORTED DEFECT: paid + unpaid is the total above them', async () => {
        const s = await stats();

        expect(s.paidMembers + s.unpaidMembers).toBe(s.totalMembers);
    });

    it('AND SO IS pending + approved', async () => {
        const s = await stats();

        expect(s.pendingMembers + s.activeMembers).toBe(s.totalMembers);
    });

    it('AND THE EXACT NUMBERS ARE NO LONGER THE ONES ON THE CARD', async () => {
        /*
         *   Stated as the defect rather than only as the repair: 109 was
         *   1840 − 1731, a subtraction from a total this screen stopped
         *   reporting. The honest answer against 3110 is 1379.
         */
        const s = await stats();

        expect(s.unpaidMembers).not.toBe(109);
        expect(s).toMatchObject({
            totalMembers: 3110,
            paidMembers: 1731,
            unpaidMembers: 1379,
            pendingMembers: 180,
            activeMembers: 2930,
        });
    });

    it('AND THE MEMBERSHIP-TABLE FIGURES SURVIVE, named for what they count', async () => {
        //   The pattern _exports and academy use: the old numbers are not
        //   deleted, they stop being presented as something they are not.
        const s = await stats();

        expect(s).toMatchObject({
            detailedMembershipRecords: 1840,
            detailedUnpaidMembers: 109,
            detailedPendingMembers: 98,
            detailedApprovedMembers: 1742,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#905 — and the two cases that must not change', () => {
    it('A SCOPED ADMIN IS UNAFFECTED — the register is platform-wide', async () => {
        /*
         *   countModuleApplicants counts a MODULE, not a cooperative, so
         *   substituting it into a scoped view would report the whole
         *   platform's members as one cooperative's. #835 says so; this proves
         *   the widening did not quietly undo it.
         */
        mockAdminScope.mockResolvedValue('coop-7');

        const s = await stats();

        expect(mockCountApplicants).not.toHaveBeenCalled();
        expect(s).toMatchObject({
            totalMembers: 1840, pendingMembers: 98, activeMembers: 1742, unpaidMembers: 109,
        });
    });

    it('AND AN UNCOUNTABLE REGISTER FALLS BACK WHOLE, not in part', async () => {
        //   registerIsUsable refuses a register smaller than the detail table —
        //   an unpopulated one would otherwise turn a real total into a
        //   confident zero. Every figure must fall back together, or the
        //   fallback recreates the defect.
        mockCountApplicants.mockResolvedValue({
            counted: false, total: null, pending: null, approved: null,
            rejected: null, revisionRequired: null, other: null,
        });

        const s = await stats();

        expect(s.applicantsCounted).toBe(false);
        expect(s).toMatchObject({
            totalMembers: 1840, pendingMembers: 98, activeMembers: 1742, unpaidMembers: 109,
        });
        expect(s.paidMembers + s.unpaidMembers).toBe(s.totalMembers);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#905 — every module switches its breakdown with its total', () => {
    /*
     *   The owner's own framing: "just like WAVE was fixed all the other
     *   modules should be fixed". This is that claim, checked rather than
     *   trusted — and it is what would have caught the cooperative card.
     */
    it.each([
        ['wave', 'src/app/api/admin/wave/compliance/route.ts'],
        ['export', 'src/app/actions/admin/_exports.ts'],
        ['academy', 'src/app/actions/academy/_ac_admin_applications.ts'],
        ['cooperative', 'src/app/actions/cooperative/_coop_admin_reports.ts'],
    ])('%s takes pending AND approved from the register, not just the total', (_m, file) => {
        const src = code(file);

        expect(src).toMatch(/applicants!?\.pending/);
        expect(src).toMatch(/applicants!?\.approved/);
    });

    it('AND FARM NATION IS THE ONE THAT LEGITIMATELY REPORTS A TOTAL ALONE', () => {
        //   The exception, stated so its absence from the list above is a
        //   judgement rather than an oversight: it publishes no breakdown, so
        //   it has nothing to contradict.
        const src = code('src/app/actions/farm-nation-admin/_fna_finance.ts');

        expect(src).toMatch(/applicants!?\.total/);
        expect(src).not.toMatch(/applicants!?\.pending/);
    });
});
