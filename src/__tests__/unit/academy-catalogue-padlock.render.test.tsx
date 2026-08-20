/**
 * @jest-environment jsdom
 */

/**
 * THE COURSE CATALOGUE DELETED EVERY CARD IT WAS SUPPOSED TO PADLOCK.
 *
 * academy/(learner)/courses/page.tsx is named, in three separate places, as the
 * screen that shows a learner which courses their plan does not open:
 *
 *   lib/academy-plan.ts                "decides which cards show a lock"
 *   academy-course-access.test.ts      "decides which cards show a lock"
 *   academy-content-gating.test.ts     "draws a padlock on the card"
 *
 * It drew none. Its filter predicate ended
 *
 *     && checkCourseAccess(userPlan, course.tier || "free")
 *
 * under the comment "Only show courses that are accessible under the user's
 * active tier", so a locked course never reached the grid — while the card
 * below branched on the SAME pure call with the SAME arguments and carried a
 * third arm reading "Upgrade to Unlock". A function cannot return false in the
 * filter and true in the render, so that arm was unreachable.
 *
 * THE SERVER HAD ALREADY DONE THE WORK
 * ------------------------------------
 * getCoursesAction does not withhold locked courses. It calls
 * stripLockedContent, which deliberately KEEPS the title, description, tier,
 * level, duration and module outline and removes only videoUrl, documentUrl,
 * excelUrl and the lesson bodies — a record whose entire purpose is to be
 * displayed locked. The browser received it and threw it away.
 *
 * WHAT IT COST
 * ------------
 *   - A Foundation learner saw no Standard or Elite course anywhere, so the
 *     catalogue could not sell the upgrade its own "Upgrade Plan" button asks
 *     for.
 *   - The Tier filter offers Standard and Elite. Choosing either produced "No
 *     Courses Match Your Criteria", which is what a catalogue with none of them
 *     also produces.
 *   - A learner who had bought no package saw only free courses — an empty page
 *     whenever the academy publishes none.
 *
 * AND THE PANEL THAT DESCRIBED THE ACCESS DISAGREED WITH THE RULE THAT GRANTED IT
 * ------------------------------------------------------------------------------
 * "Your Learning Plan" was decided by raw string equality — `userPlan ===
 * "elite"` and a nested ternary — while checkCourseAccess beside it trims,
 * lower-cases and maps the legacy "advanced" onto "standard".
 * academy-course-access.test.ts asserts `checkCourseAccess(" Elite ", "elite")`
 * is true, so a learner whose stored plan carried a stray space was shown every
 * elite course, told their access was "Free, Foundation & Standard", and
 * offered an Upgrade Plan button for the tier they had already paid for.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockUseSession = jest.fn();
const mockGetCourses = jest.fn();
const mockGetEnrolled = jest.fn();
const mockShowToast = jest.fn();

jest.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));

/**
 * A STABLE router, which the global mock in jest.setup.js is not.
 *
 * That one builds a fresh object on every `useRouter()` call, and this page's
 * load effect lists `[router]`. Under the global mock each render produces a
 * new dependency and re-runs the effect for ever; under the real App Router
 * `useRouter()` is stable across renders and the effect runs once, which is
 * what the page is written against. Mocking it stably here tests the page
 * rather than the harness.
 */
const stableRouter = { push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => stableRouter,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '',
}));

jest.mock('@/app/actions/academy', () => ({
    getCoursesAction: (...a: any[]) => mockGetCourses(...a),
    getEnrolledCoursesWithDetailsAction: (...a: any[]) => mockGetEnrolled(...a),
}));

jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('@/components/ui/BackButton', () => ({
    __esModule: true,
    default: () => null,
}));

import CourseCatalogPage from '@/app/academy/(learner)/courses/page';

/** The catalogue as the server sends it: every tier, locked ones included. */
const CATALOGUE = [
    course('c-free', 'Export Basics', 'free'),
    course('c-foundation', 'Documentation Essentials', 'foundation'),
    course('c-standard', 'Buyer Negotiation', 'standard'),
    course('c-elite', 'Global Trade Finance', 'elite'),
];

function course(id: string, title: string, tier: string) {
    return {
        id,
        title,
        description: `A course about ${title.toLowerCase()} for exporters everywhere.`,
        instructor: 'Ngozi Eze',
        duration: '4 weeks',
        level: 'beginner',
        tier,
        price: 0,
        modules: [{ id: 'm1', title: 'One', lessons: [{ id: 'l1', title: 'Intro', locked: true }] }],
    };
}

function signedInWith(plan: unknown) {
    mockUseSession.mockReturnValue({
        status: 'authenticated',
        data: {
            user: {
                id: 'learner-1',
                email: 'a@b.com',
                roles: ['academy_participant'],
                serviceRegistrations: { academy: { plan, status: 'approved' } },
            },
        },
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGetCourses.mockResolvedValue({ success: true, data: CATALOGUE, error: null });
    mockGetEnrolled.mockResolvedValue({ success: true, data: { courses: [] }, error: null });
});

async function mount() {
    render(<CourseCatalogPage />);
    await waitFor(() => expect(screen.getAllByTestId('course-card').length).toBeGreaterThan(0));
}

/** The CTA text on the card with this title. */
function ctaFor(title: string): string {
    const card = screen.getAllByTestId('course-card')
        .find((el) => el.textContent?.includes(title));
    if (!card) throw new Error(`no card for "${title}"`);
    for (const label of ['Upgrade to Unlock', 'Resume Course', 'Start Course']) {
        if (card.textContent?.includes(label)) return label;
    }
    throw new Error(`card for "${title}" has no CTA`);
}

// ─── the padlock ─────────────────────────────────────────────────────────────

describe('the catalogue shows courses the plan does not open', () => {
    it('a foundation learner sees all four tiers, not one', async () => {
        signedInWith('foundation');
        await mount();

        expect(screen.getAllByTestId('course-card')).toHaveLength(4);
        expect(screen.getByText('Global Trade Finance')).toBeInTheDocument();
        expect(screen.getByText('Buyer Negotiation')).toBeInTheDocument();
    });

    it('and the locked ones carry the padlock, not a Start button', async () => {
        signedInWith('foundation');
        await mount();

        expect(ctaFor('Export Basics')).toBe('Start Course');
        expect(ctaFor('Documentation Essentials')).toBe('Start Course');
        expect(ctaFor('Buyer Negotiation')).toBe('Upgrade to Unlock');
        expect(ctaFor('Global Trade Finance')).toBe('Upgrade to Unlock');
    });

    it('the padlock links to the upgrade page', async () => {
        signedInWith('foundation');
        await mount();

        const locked = screen.getAllByRole('link', { name: /Upgrade to Unlock/ });
        expect(locked).toHaveLength(2);
        for (const link of locked) {
            expect(link).toHaveAttribute('href', '/academy/application');
        }
    });

    it('an elite learner sees no padlock at all', async () => {
        signedInWith('elite');
        await mount();

        expect(screen.getAllByTestId('course-card')).toHaveLength(4);
        expect(screen.queryByText('Upgrade to Unlock')).not.toBeInTheDocument();
    });

    it('a learner who bought no package still sees the paid catalogue, locked', async () => {
        // Registration is free, so "no plan" is a real state — and it is the one
        // where an empty catalogue is most misleading, because it looks like the
        // academy has published nothing.
        signedInWith(undefined);
        await mount();

        expect(screen.getAllByTestId('course-card')).toHaveLength(4);
        expect(ctaFor('Export Basics')).toBe('Start Course');
        expect(ctaFor('Documentation Essentials')).toBe('Upgrade to Unlock');
    });

    it('the Tier filter can find a tier the learner has not bought', async () => {
        // Every option in this dropdown returned "No Courses Match Your
        // Criteria" for anyone below that tier — indistinguishable from a
        // catalogue that has none.
        signedInWith('foundation');
        await mount();

        fireEvent.change(screen.getByDisplayValue('All Tiers'), { target: { value: 'elite' } });

        const cards = screen.getAllByTestId('course-card');
        expect(cards).toHaveLength(1);
        expect(cards[0].textContent).toContain('Global Trade Finance');
        expect(cards[0].textContent).toContain('Upgrade to Unlock');
    });

    it('search still narrows the list, locked cards included', async () => {
        signedInWith('foundation');
        await mount();

        fireEvent.change(screen.getByPlaceholderText('Search courses, instructors...'), {
            target: { value: 'trade finance' },
        });

        const cards = screen.getAllByTestId('course-card');
        expect(cards).toHaveLength(1);
        expect(cards[0].textContent).toContain('Global Trade Finance');
    });
});

// ─── an enrolment that outlived its plan ─────────────────────────────────────

describe('access decides the card before enrolment does', () => {
    it('an enrolled course the plan no longer opens shows the padlock', async () => {
        // "Resume Course" linked to /academy/{id}, which checks the same rule on
        // load and pushes the learner to /academy/application. A button whose
        // only outcome is a redirect to the upgrade page is the upgrade button.
        mockGetEnrolled.mockResolvedValue({
            success: true,
            error: null,
            data: { courses: [{ courseId: 'c-elite' }, { courseId: 'c-free' }] },
        });
        signedInWith('foundation');
        await mount();

        expect(ctaFor('Global Trade Finance')).toBe('Upgrade to Unlock');
        expect(ctaFor('Export Basics')).toBe('Resume Course');
    });
});

// ─── the plan panel ──────────────────────────────────────────────────────────

describe('the Learning Plan panel agrees with the rule that grants the access', () => {
    it('names the tiers the plan actually opens', async () => {
        signedInWith('foundation');
        await mount();
        expect(screen.getByText('Access to Free & Foundation courses')).toBeInTheDocument();

        jest.clearAllMocks();
        mockGetCourses.mockResolvedValue({ success: true, data: CATALOGUE, error: null });
        mockGetEnrolled.mockResolvedValue({ success: true, data: { courses: [] }, error: null });
        signedInWith('standard');
        render(<CourseCatalogPage />);
        await waitFor(() =>
            expect(screen.getByText('Access to Free, Foundation & Standard courses')).toBeInTheDocument(),
        );
    });

    it('says Free only for a learner who bought no package', async () => {
        // The old ternary fell through to "Free, Foundation & Standard" for
        // every plan it did not recognise by name, which included this one and
        // the legacy "advanced".
        signedInWith('registration');
        await mount();

        expect(screen.getByText('Access to Free courses')).toBeInTheDocument();
    });

    it('reads a plan with stray capitals and spacing the way the access rule does', async () => {
        // checkCourseAccess(" Elite ", "elite") is true, so this learner sees
        // every elite course. The panel used to tell them they had "Free,
        // Foundation & Standard" and offer them an upgrade.
        signedInWith(' Elite ');
        await mount();

        expect(screen.getByText('Unlimited access to all courses')).toBeInTheDocument();
        expect(screen.queryByText('Upgrade Plan')).not.toBeInTheDocument();
        expect(screen.queryByText('Upgrade to Unlock')).not.toBeInTheDocument();
    });

    it('treats the legacy "advanced" as standard, as the access rule does', async () => {
        signedInWith('advanced');
        await mount();

        expect(screen.getByText('Access to Free, Foundation & Standard courses')).toBeInTheDocument();
        expect(ctaFor('Buyer Negotiation')).toBe('Start Course');
        expect(ctaFor('Global Trade Finance')).toBe('Upgrade to Unlock');
    });

    it('offers Upgrade Plan to everyone below elite, and nobody at it', async () => {
        signedInWith('standard');
        await mount();
        expect(screen.getByText('Upgrade Plan')).toBeInTheDocument();
    });
});
