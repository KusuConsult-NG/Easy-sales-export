/**
 * @jest-environment jsdom
 */

/**
 *   #595 THE LAST ELEVEN — AND THE INSTRUMENT WAS OVER-COUNTING THREE OF THEM.
 *
 *   #588 measured this class at 35 screens that told people their things were
 *   gone when the truth was "we could not read this". #592 took it to 23 and
 *   found the predicate was wrong about MessagesClient. #594 took it to 17 and
 *   recorded that the ratchet cannot see the same lie told in NUMBERS. This
 *   takes the remaining ones and closes the ledger at zero.
 *
 *   The eleven, and what each said when nothing had been read:
 *
 *     export/dashboard          "No active investments yet" over money in
 *                               escrow — with the four totals above it still
 *                               reading ₦0, which is #594's louder half again.
 *     academy/courses           "No Courses Match Your Criteria. Try loosening
 *                               your search terms" when the CATALOGUE was never
 *                               fetched: the learner is sent to widen a filter
 *                               over a list that does not exist, and clearing
 *                               every filter changes nothing.
 *     academy/dashboard         "You haven't enrolled in any courses yet", to
 *                               somebody who has paid for the Academy.
 *     academy/live              "No Active Live Classes. Check back when a
 *                               session is scheduled" — come back later for a
 *                               class that may be broadcasting right now.
 *     cooperatives/directory    "No members found. Try adjusting your search
 *                               terms", sending a member hunting through a
 *                               search box for people never asked about.
 *     farm-nation landing       "No verified properties yet. Be the first to
 *                               list your farm!" — on the PUBLIC page, to every
 *                               visitor who arrives while the read is failing.
 *     village-market seller     "No Events Available. Check back soon."
 *     wave/dashboard            "No resources available yet" and "No upcoming
 *                               training events".
 *     wave/training             "No Training Events."
 *     wave/live-training        "No sessions scheduled yet."
 *     wave/earnings             see WHAT IS NOT CLAIMED — this one is different.
 *
 * ── THREE OF THEM HAD NO try AT ALL ─────────────────────────────────────────
 *
 *   VillageMarketSellerClient, CooperativeDirectoryClient and the wallet
 *   (#592's) each awaited a server action with nothing around it, so a REJECTED
 *   call skipped the assignment AND skipped `setLoading(false)` — the spinner
 *   turned for as long as the page stayed open. #407 found that shape on the
 *   wallet's fund and withdraw buttons; it is on read paths too. Those files
 *   were in this count because of a `catch` belonging to some other handler
 *   further down, which is worth knowing about the predicate.
 *
 * ── TWO SCREENS ALREADY DID THE HARD HALF AND NOT THE EASY ONE ──────────────
 *
 *   /wave/dashboard and /academy/dashboard both use `Promise.allSettled` ON
 *   PURPOSE — the comments say "one failing panel must not cost the other two"
 *   and "a failing live-session lookup must not cost the member their course
 *   list". Then every `if (settled.status === "fulfilled")` had no else, so a
 *   rejected half was recorded nowhere at all and the isolation they had paid
 *   for produced three panels that each said "there is nothing".
 *
 *   And /cooperatives/fixed-savings — #594's — is the same story inside one
 *   function: `membershipCheckFailed` twenty lines above a plans read with no
 *   else. THE FIX REACHES ONE DOOR.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   WAVE EARNINGS WAS NOT THE #588 DEFECT, and calling it one would have been
 *   the louder, falser finding. A failed read there already produced a FAILURE
 *   message and not an empty state. What it produced was one bare grey line —
 *   "Failed to load earnings data" — with no reassurance that the money is
 *   still there and no way to try again, on the screen where a WAVE member
 *   checks what they are owed; and its `catch` was completely empty, so a
 *   thrown read said nothing whatsoever. It is in the ledger because it now
 *   says what the others say, not because it was telling anyone their earnings
 *   were zero.
 *
 *   NO READ WAS MADE MORE RELIABLE. Every one of these fails as often as it did.
 *
 *   ONE FLAG PER READ, NOT PER LIST. /academy/live splits ONE
 *   getLiveSessionsAction result into live and recorded sessions, so it has one
 *   flag — the opposite of #592's certificates screen, which had one flag per
 *   endpoint because it has two endpoints. The rule is the read, not the panel.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

const getUserExportStatsAction = jest.fn() as jest.Mock<any>;
const getUserExportInvestmentsAction = jest.fn() as jest.Mock<any>;
const getCoursesAction = jest.fn() as jest.Mock<any>;
const getEnrolledCoursesWithDetailsAction = jest.fn() as jest.Mock<any>;
const getLiveSessionsAction = jest.fn() as jest.Mock<any>;
const getDirectoryMembersAction = jest.fn() as jest.Mock<any>;
const searchLandListingsAction = jest.fn() as jest.Mock<any>;
const getActiveVillageMarketEventsAction = jest.fn() as jest.Mock<any>;
const getWaveMemberStatsAction = jest.fn() as jest.Mock<any>;
const getWaveResourcesAction = jest.fn() as jest.Mock<any>;
const getWaveTrainingEventsAction = jest.fn() as jest.Mock<any>;
const getUserTrainingRegistrationsAction = jest.fn() as jest.Mock<any>;
const calculateEarningsAction = jest.fn() as jest.Mock<any>;
const checkWaveMembershipAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/export', () => ({
    getUserExportStatsAction: (...a: any[]) => getUserExportStatsAction(...a),
    getUserExportInvestmentsAction: (...a: any[]) => getUserExportInvestmentsAction(...a),
}));
jest.mock('@/app/actions/academy', () => ({
    getCoursesAction: (...a: any[]) => getCoursesAction(...a),
    getEnrolledCoursesWithDetailsAction: (...a: any[]) => getEnrolledCoursesWithDetailsAction(...a),
    getLiveSessionsAction: (...a: any[]) => getLiveSessionsAction(...a),
    checkAcademyPaymentStatusAction: jest.fn(async () => ({ success: true, error: null, data: { hasPaid: true } })),
    enrollInCourseAction: jest.fn(),
}));
jest.mock('@/app/actions/cooperative', () => ({
    getDirectoryMembersAction: (...a: any[]) => getDirectoryMembersAction(...a),
}));
jest.mock('@/app/actions/farm-nation', () => ({
    checkFarmNationStatusAction: jest.fn(async () => ({ success: true, error: null, data: { isMember: true, status: 'approved' } })),
}));
jest.mock('@/app/actions/messages', () => ({
    startConversationAction: jest.fn(),
    startSupportConversationAction: jest.fn(),
}));
jest.mock('@/app/actions/land-listings', () => ({
    searchLandListingsAction: (...a: any[]) => searchLandListingsAction(...a),
}));
jest.mock('@/app/actions/village-market', () => ({
    getActiveVillageMarketEventsAction: (...a: any[]) => getActiveVillageMarketEventsAction(...a),
    joinVillageMarketEventAction: jest.fn(),
    addFlashSaleProductAction: jest.fn(),
}));
jest.mock('@/app/actions/wave', () => ({
    getWaveMemberStatsAction: (...a: any[]) => getWaveMemberStatsAction(...a),
    getWaveResourcesAction: (...a: any[]) => getWaveResourcesAction(...a),
    getWaveTrainingEventsAction: (...a: any[]) => getWaveTrainingEventsAction(...a),
    getUserTrainingRegistrationsAction: (...a: any[]) => getUserTrainingRegistrationsAction(...a),
    calculateEarningsAction: (...a: any[]) => calculateEarningsAction(...a),
    checkWaveMembershipAction: (...a: any[]) => checkWaveMembershipAction(...a),
    withdrawEarningsAction: jest.fn(),
    registerForTrainingAction: jest.fn(),
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: { user: { id: 'u1', name: 'Ada', email: 'ada@example.com', roles: [] } },
        status: 'authenticated',
    }),
}));
/**
 * ONE ROUTER OBJECT, NOT A NEW ONE PER CALL.
 *
 * CourseCatalogClient's load effect is `useEffect(() => { loadData(); },
 * [router])`. Next's own useRouter returns a STABLE object, so that runs once;
 * a mock that builds a fresh `{ push }` every render makes the dependency
 * change on every render and the screen reloads itself forever — it sat on
 * "Loading..." until the test timed out. The harness has to match the thing it
 * stands in for, which is this file's own recurring lesson pointed inward.
 */
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
    useParams: () => ({}),
}));
jest.mock('@/hooks/useFeatureToggle', () => ({
    useFeatureToggle: () => true,
}));
jest.mock('@/hooks/useMembershipStatus', () => ({
    useMembershipStatus: () => ({ status: 'approved', loading: false }),
}));

const FAILED = /we could not load/i;

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#595 — the export investor dashboard', () => {
    async function dashboard(opts: { stats?: any; investments?: any } = {}) {
        const fail = { success: false, error: 'unavailable', data: null };
        getUserExportStatsAction.mockResolvedValue(opts.stats ?? fail);
        getUserExportInvestmentsAction.mockResolvedValue(opts.investments ?? fail);
        const { default: ExportDashboardClient } =
            await import('@/app/export/(app)/dashboard/ExportDashboardClient');
        return render(<ExportDashboardClient initial={null} />);
    }

    it('NO "No active investments yet" AND NO ₦0 TOTALS OVER A FAILED READ', async () => {
        const { container } = await dashboard();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no active investments yet|total invested/i);
    });

    it('AND THE TWO READS ARE SEPARATE', async () => {
        const { container } = await dashboard({
            stats: {
                success: true, error: null,
                data: { totalInvested: 750_000, activeInvestments: 3, totalReturns: 40_000, pendingReturns: 12_000 },
            },
        });

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).toContain('750,000');
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(1);
    });

    it('AND AN INVESTOR WITH NOTHING YET SEES ZEROES, BECAUSE THAT IS TRUE', async () => {
        const { container } = await dashboard({
            stats: {
                success: true, error: null,
                data: { totalInvested: 0, activeInvestments: 0, totalReturns: 0, pendingReturns: 0 },
            },
            investments: { success: true, error: null, data: [] },
        });

        await waitFor(() => expect(container.textContent).toMatch(/no active investments yet/i));
        expect(container.textContent).toMatch(/total invested/i);
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#595 — the academy', () => {
    it('A LEARNER IS NOT TOLD TO LOOSEN A FILTER OVER A CATALOGUE NOBODY FETCHED', async () => {
        getCoursesAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });
        getEnrolledCoursesWithDetailsAction.mockResolvedValue({ success: true, error: null, data: { courses: [] } });

        const { default: CourseCatalogClient } =
            await import('@/app/academy/(learner)/courses/CourseCatalogClient');
        const { container } = render(<CourseCatalogClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no courses match your criteria/i);
    });

    it('AND A SEARCH THAT MATCHES NOTHING IS STILL A SEARCH', async () => {
        //   The guard is on `courses`, not on `filteredCourses`: a filter that
        //   excludes every one of forty courses must say so, not claim a
        //   failure.
        getCoursesAction.mockResolvedValue({
            success: true, error: null,
            data: [{ id: 'c1', title: 'Cocoa Agronomy', level: 'beginner', tier: 'free', description: 'x', instructor: 'Mr Bello' }],
        });
        getEnrolledCoursesWithDetailsAction.mockResolvedValue({ success: true, error: null, data: { courses: [] } });

        const { default: CourseCatalogClient } =
            await import('@/app/academy/(learner)/courses/CourseCatalogClient');
        const { container, getByPlaceholderText } = render(<CourseCatalogClient initial={null} />);
        await waitFor(() => expect(container.textContent).toContain('Cocoa Agronomy'));

        const { fireEvent, act } = await import('@testing-library/react');
        await act(async () => {
            fireEvent.change(getByPlaceholderText(/search/i), { target: { value: 'zzzz-no-such-course' } });
        });

        await waitFor(() => expect(container.textContent).toMatch(/no courses match your criteria/i));
        expect(container.textContent).not.toMatch(FAILED);
    });

    it('AND ONE COURSE WITHOUT AN INSTRUCTOR DOES NOT TAKE THE CATALOGUE DOWN', async () => {
        /**
         *   #589's CLASS, FOUND BY A FIXTURE THAT HAPPENED NOT TO CARRY ONE.
         *
         *   The filter read `course.instructor.toLowerCase()` — and `title` and
         *   `description` the same way — on every row on every keystroke. A
         *   course document written without one of those three throws DURING
         *   RENDER, so the catalogue does not lose the row: it loses the page.
         *   Nothing in the admin course form requires an instructor.
         *
         *   This was not on the #588 list and is not a failed-read defect. It
         *   is recorded here because this is the commit that found it.
         */
        getCoursesAction.mockResolvedValue({
            success: true, error: null,
            data: [
                { id: 'c1', title: 'Cocoa Agronomy', level: 'beginner', tier: 'free', description: 'x', instructor: 'Mr Bello' },
                { id: 'c2', title: 'Cassava Processing', level: 'beginner', tier: 'free' },
                { id: 'c3', description: 'no title at all', level: 'beginner', tier: 'free' },
            ],
        });
        getEnrolledCoursesWithDetailsAction.mockResolvedValue({ success: true, error: null, data: { courses: [] } });

        const { default: CourseCatalogClient } =
            await import('@/app/academy/(learner)/courses/CourseCatalogClient');
        const { container, getByPlaceholderText } = render(<CourseCatalogClient initial={null} />);

        //   The page is there and so are the other courses.
        await waitFor(() => expect(container.textContent).toContain('Cocoa Agronomy'));
        expect(container.textContent).toContain('Cassava Processing');

        //   And typing — which re-runs the filter over every row — does not
        //   blank it either.
        const { fireEvent, act } = await import('@testing-library/react');
        await act(async () => {
            fireEvent.change(getByPlaceholderText(/search/i), { target: { value: 'cassava' } });
        });
        await waitFor(() => expect(container.textContent).toContain('Cassava Processing'));
        expect(container.textContent).not.toContain('Cocoa Agronomy');
    });

    it('AND A LIVE-CLASSES READ THAT FAILED IS NOT "No Active Live Classes"', async () => {
        getLiveSessionsAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { default: AcademyLiveClient } =
            await import('@/app/academy/live/AcademyLiveClient');
        const { container } = render(<AcademyLiveClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no active live classes/i);
    });

    it('AND WHEN THERE GENUINELY ARE NONE, IT SAYS SO', async () => {
        getLiveSessionsAction.mockResolvedValue({ success: true, error: null, data: [] });

        const { default: AcademyLiveClient } =
            await import('@/app/academy/live/AcademyLiveClient');
        const { container } = render(<AcademyLiveClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(/no active live classes/i));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#595 — the cooperative directory, which had no try at all', () => {
    async function directory(reply: any) {
        if (reply instanceof Error) getDirectoryMembersAction.mockRejectedValue(reply);
        else getDirectoryMembersAction.mockResolvedValue(reply);
        const { default: CooperativeDirectoryClient } =
            await import('@/app/cooperatives/(member)/directory/CooperativeDirectoryClient');
        return render(<CooperativeDirectoryClient initial={null} />);
    }

    it('A FAILED READ IS NOT "No members found"', async () => {
        const { container } = await directory({ success: false, error: 'unavailable', data: null });

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no members found|adjusting your search/i);
    });

    it('AND A REJECTED READ STOPS THE SPINNER, WHICH IT DID NOT BEFORE', async () => {
        //   There was no try here at all, so a rejection skipped
        //   `setLoading(false)` and the spinner turned for as long as the page
        //   stayed open. #407's shape on a read path.
        const { container } = await directory(new Error('network down'));

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.querySelectorAll('.animate-spin')).toHaveLength(0);
    });

    it('AND A COOPERATIVE WITH NO OTHER MEMBERS STILL SAYS SO', async () => {
        const { container } = await directory({ success: true, error: null, data: { members: [] } });

        await waitFor(() => expect(container.textContent).toMatch(/no members found/i));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#595 — farm nation, on the page strangers land on', () => {
    async function landing(reply: any) {
        if (reply instanceof Error) searchLandListingsAction.mockRejectedValue(reply);
        else searchLandListingsAction.mockResolvedValue(reply);
        const { default: FarmNationLandingClient } =
            await import('@/app/farm-nation/FarmNationLandingClient');
        return render(<FarmNationLandingClient initial={null} />);
    }

    it('A VISITOR IS NOT TOLD THE MARKETPLACE IS EMPTY WHEN NOBODY ASKED IT', async () => {
        const { container } = await landing(new Error('network down'));

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no verified properties yet|be the first to list/i);
    });

    it('AND THE PAGE STILL RENDERS, WHICH WAS THE ORIGINAL INTENT', async () => {
        //   Its catch said "Graceful fallback — don't break the landing page".
        //   That instinct was right and is kept: the rest of the page is there.
        const { container } = await landing(new Error('network down'));

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).toMatch(/farm/i);
    });

    it('AND A MARKETPLACE WITH NOTHING VERIFIED YET SAYS SO', async () => {
        const { container } = await landing({ success: true, error: null, data: { listings: [] } });

        await waitFor(() => expect(container.textContent).toMatch(/no verified properties yet/i));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#595 — the village market, which also had no try', () => {
    async function villageMarket(reply: any) {
        if (reply instanceof Error) getActiveVillageMarketEventsAction.mockRejectedValue(reply);
        else getActiveVillageMarketEventsAction.mockResolvedValue(reply);
        const { default: VillageMarketSellerClient } =
            await import('@/app/marketplace/village-market/seller/VillageMarketSellerClient');
        return render(<VillageMarketSellerClient initial={null} />);
    }

    it('A REJECTED READ IS NOT "No Events Available", AND STOPS THE SPINNER', async () => {
        const { container } = await villageMarket(new Error('network down'));

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no events available|check back soon/i);
        expect(container.querySelectorAll('.animate-spin')).toHaveLength(0);
    });

    it('AND A QUIET WEEK IS STILL A QUIET WEEK', async () => {
        const { container } = await villageMarket([]);

        await waitFor(() => expect(container.textContent).toMatch(/no events available/i));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#595 — WAVE', () => {
    const ok = (data: any) => ({ success: true, error: null, data });
    const fail = { success: false, error: 'unavailable', data: null };

    it('THE DASHBOARD RECORDS WHAT ITS OWN allSettled WAS FOR', async () => {
        /**
         *   It uses allSettled on purpose — "one failing panel must not cost
         *   the other two" — and then recorded no failure anywhere, so the
         *   isolation it paid for produced two panels saying "there is
         *   nothing".
         */
        getWaveMemberStatsAction.mockResolvedValue(ok({ stats: { resourcesAccessed: 1, trainingsRegistered: 1, trainingsCompleted: 0, daysActive: 9 } }));
        getWaveResourcesAction.mockRejectedValue(new Error('network down'));
        getWaveTrainingEventsAction.mockRejectedValue(new Error('network down'));

        const { default: WaveDashboard } = await import('@/app/wave/(member)/dashboard/page');
        const { container } = render(<WaveDashboard />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no resources available yet|no upcoming training events/i);
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(2);
    });

    it('AND ONE FAILING PANEL REALLY DOES NOT COST THE OTHER', async () => {
        getWaveMemberStatsAction.mockResolvedValue(ok({ stats: { resourcesAccessed: 1, trainingsRegistered: 1, trainingsCompleted: 0, daysActive: 9 } }));
        getWaveResourcesAction.mockResolvedValue(ok([
            { id: 'r1', title: 'Cocoa grading guide', description: 'How to grade', category: 'Guides', downloads: 4 },
        ]));
        getWaveTrainingEventsAction.mockRejectedValue(new Error('network down'));

        const { default: WaveDashboard } = await import('@/app/wave/(member)/dashboard/page');
        const { container } = render(<WaveDashboard />);

        await waitFor(() => expect(container.textContent).toContain('Cocoa grading guide'));
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(1);
    });

    it('AND AN EMPTY PANEL BESIDE A FAILED ONE IS STILL EMPTY, NOT FAILED', async () => {
        /**
         *   A SURVIVING MUTANT IS WHY THIS TEST EXISTS. Collapsing the two
         *   flags into one changed nothing in the test above, because that one
         *   gives the resources panel ROWS and the list is checked before the
         *   flag. The difference only shows when a read SUCCEEDS AND RETURNS
         *   NOTHING beside one that failed — which is the exact case a shared
         *   flag gets wrong, and #592's certificates lesson stated in the
         *   other direction.
         */
        getWaveMemberStatsAction.mockResolvedValue(ok({ stats: { resourcesAccessed: 0, trainingsRegistered: 0, trainingsCompleted: 0, daysActive: 1 } }));
        getWaveResourcesAction.mockResolvedValue(ok([]));
        getWaveTrainingEventsAction.mockRejectedValue(new Error('network down'));

        const { default: WaveDashboard } = await import('@/app/wave/(member)/dashboard/page');
        const { container } = render(<WaveDashboard />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        //   The resources half read fine and is genuinely empty; it says so.
        expect(container.textContent).toMatch(/no resources available yet/i);
        expect(container.textContent).not.toMatch(/no upcoming training events/i);
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(1);
    });

    it('AND THE TRAINING LIST DOES NOT SAY "No Training Events"', async () => {
        checkWaveMembershipAction.mockResolvedValue(ok({ enrolled: true }));
        getWaveTrainingEventsAction.mockResolvedValue(fail);
        getUserTrainingRegistrationsAction.mockResolvedValue(ok({ registrations: [] }));

        const { default: WaveTrainingClient } =
            await import('@/app/wave/(member)/training/WaveTrainingClient');
        const { container } = render(<WaveTrainingClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no training events/i);
    });

    it('AND THE LIVE-TRAINING LIST DOES NOT SAY "No sessions scheduled yet"', async () => {
        (global as any).fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));

        const { default: LiveTrainingClient } =
            await import('@/app/wave/(member)/live-training/LiveTrainingClient');
        const { container } = render(<LiveTrainingClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no sessions scheduled yet/i);
    });

    it('AND WHEN NOTHING IS SCHEDULED, IT SAYS SO', async () => {
        (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: { sessions: [] } }) }));

        const { default: LiveTrainingClient } =
            await import('@/app/wave/(member)/live-training/LiveTrainingClient');
        const { container } = render(<LiveTrainingClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(/no sessions scheduled yet/i));
        expect(container.textContent).not.toMatch(FAILED);
    });

    it('AND THE EARNINGS SCREEN SAYS THE MONEY IS STILL THERE', async () => {
        /**
         *   NOT THE #588 DEFECT — see the header. This screen already showed a
         *   FAILURE and not an empty state; it showed it as one bare grey line
         *   with no retry, on the screen where a member checks what they are
         *   owed, and its catch was empty so a THROWN read said nothing at all.
         */
        calculateEarningsAction.mockRejectedValue(new Error('network down'));

        const { default: WaveEarningsClient } =
            await import('@/app/wave/(member)/earnings/WaveEarningsClient');
        const { container } = render(<WaveEarningsClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).toMatch(/nothing is lost/i);
        expect(container.textContent).not.toMatch(/failed to load earnings data/i);
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     export: stats else dropped                       KILLED
 *     export: investments else dropped                 KILLED (2 tests)
 *     export: the zeroed stat grid shown anyway        KILLED
 *     export: one flag shared by both reads            KILLED
 *     academy courses: the else stops recording        KILLED
 *     academy courses: instructor read unguarded again KILLED
 *     academy live: else dropped                       KILLED
 *     academy live: panel branch removed               KILLED
 *     directory: the new try removed                   KILLED
 *     directory: else dropped                          KILLED
 *     directory: empty state shown anyway              KILLED
 *     farm nation: catch stops recording               KILLED (2)
 *     farm nation: panel branch removed                KILLED (2)
 *     village market: the new try removed              KILLED
 *     village market: panel branch removed             KILLED
 *     wave dashboard: resources rejected branch dropped KILLED
 *     wave dashboard: events rejected branch dropped   KILLED (2)
 *     wave dashboard: one flag shared by both panels   KILLED  ← see below
 *     wave training: else dropped                      KILLED
 *     wave live-training: else dropped                 KILLED
 *     ratchet: CAP raised to 5                         KILLED
 *     ratchet: the JSX-branch rule widened back        KILLED (2)
 *     ratchet: a fourth exclusion smuggled in          KILLED
 *     reword this header                               SURVIVED, as intended
 *
 *   ONE SURVIVED THE FIRST RUN AND NOW DOES NOT. Collapsing the WAVE
 *   dashboard's two flags into one changed nothing, because the test that
 *   covered it gave the resources panel ROWS and the list is checked before the
 *   flag. The difference only shows when a read SUCCEEDS AND RETURNS NOTHING
 *   beside one that failed — which is precisely the case a shared flag gets
 *   wrong. There is a test for that now.
 *
 * ── AND TWO MUTANTS ARE STILL STANDING, NAMED RATHER THAN HIDDEN ────────────
 *
 *   THE COURSE CATALOGUE'S GUARD, `courses` swapped for `filteredCourses`,
 *   survives and is EQUIVALENT TODAY: the screen reads once, so whenever
 *   `loadFailed` is true `courses` is still `[]` and so is anything filtered
 *   from it. The unfiltered list is kept because the sentence is about the
 *   catalogue and not about the search box. #594 recorded the identical mutant
 *   on the cooperative history screen, for the identical reason.
 *
 *   WAVE EARNINGS' CATCH, emptied back out, survives and is NOT equivalent —
 *   and that is the honest statement rather than the flattering one. On a FRESH
 *   load the two are indistinguishable: `earnings` is null either way and the
 *   panel renders either way. The difference is on a REFRESH — `loadEarnings`
 *   is called again after a successful withdrawal — where the old empty catch
 *   left the pre-withdrawal figures on screen as though nothing had happened.
 *   Reaching that path from a test means driving the withdrawal modal, the
 *   feature toggle and the amount field to get one extra call, and I have not
 *   written it. The change is right; it is covered on one of its two paths, and
 *   this is which one.
 */
