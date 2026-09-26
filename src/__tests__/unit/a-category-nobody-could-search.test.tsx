/**
 * @jest-environment jsdom
 */

/**
 *   #949 FIVE CATEGORIES COLLECTED, STORED, AND READ BY NOTHING.
 *
 *   The admin create and edit forms offer a course category from five options,
 *   and since #930 the actions store the answer. Then nothing anywhere read it.
 *   academy-course-fields said so in its own header:
 *
 *       "Nothing READS `course.category` yet — the catalogue filters on level
 *        and tier — so this is recorded rather than displayed, which is a
 *        smaller wrong than a select that discards the answer it asked for. A
 *        category filter is a product decision and needs a reader."
 *
 *   It IS a smaller wrong, and it is still one. An administrator filing a course
 *   under Logistics & Shipping has been told, by a control that looks like every
 *   other control on that form, that the choice does something.
 *
 *   ── WHY THIS IS NOT A PRODUCT DECISION ────────────────────────────────────
 *
 *   The catalogue's own panel is headed "Search & Filter Catalog" and already
 *   holds a search box, a DIFFICULTY filter and a PLAN TIER filter. Level and
 *   tier are stored by the same form, in the same submit, and read the same way.
 *   So the category filter is the third of three rather than a new idea about
 *   what the catalogue is for — and the alternative on the table was to stop
 *   asking, which throws away five values already on the rows.
 *
 *   ── AND THE SEARCH BOX WAS PART OF IT ─────────────────────────────────────
 *
 *   The haystack was title + description + instructor. A learner who types
 *   "Logistics" gets nothing unless a course happens to say it in prose, and the
 *   LABEL is what they would type: `logistics` is a slug the admin form renders
 *   as "Logistics & Shipping" and never shows in raw form. Searching the slug
 *   would have been a reader in name only.
 *
 *   MOUNTED, NOT READ. A source ratchet cannot tell a filter that filters from a
 *   <select> that sets state nobody consults — which is the whole finding here,
 *   one level up. Each case renders the catalogue, drives the real control, and
 *   reads the rows that survive.
 *
 *   THE GLOBAL `jest`, per #392: taking it from '@jest/globals' defeats
 *   jest.mock hoisting, and a render suite imports its subject.
 */

import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { COURSE_CATEGORIES } from '@/lib/academy-course-fields';

const getCoursesAction = jest.fn() as jest.Mock<any>;
const getEnrolledCoursesWithDetailsAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/academy', () => ({
    getCoursesAction: (...a: any[]) => getCoursesAction(...a),
    getEnrolledCoursesWithDetailsAction: (...a: any[]) => getEnrolledCoursesWithDetailsAction(...a),
    enrollInCourseAction: jest.fn(),
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
 * ONE ROUTER OBJECT, not a new one per call — the-last-eleven-screens records
 * why: this screen's load effect lists `router`, and a mock that rebuilds it on
 * every render reloads the screen forever and sits on "Loading…".
 */
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/academy/courses',
    useParams: () => ({}),
}));

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

const CATALOGUE = 'src/app/academy/(learner)/courses/CourseCatalogClient.tsx';

/** Three free courses, in three different categories. One carries none at all. */
const ROWS = [
    {
        id: 'c1', title: 'Cocoa Agronomy', description: 'Growing it', instructor: 'Mr Bello',
        level: 'beginner', tier: 'free', price: 0, category: 'logistics', modules: [],
    },
    {
        id: 'c2', title: 'Paperwork Abroad', description: 'Forms', instructor: 'Mrs Okoro',
        level: 'beginner', tier: 'free', price: 0, category: 'compliance', modules: [],
    },
    {
        //   A row written before #930 stored the field at all. There are real ones.
        id: 'c3', title: 'An Older Course', description: 'From before', instructor: 'Mr Eze',
        level: 'beginner', tier: 'free', price: 0, modules: [],
    },
];

async function mountCatalogue() {
    getCoursesAction.mockResolvedValue({ success: true, error: null, data: ROWS });
    getEnrolledCoursesWithDetailsAction.mockResolvedValue({ success: true, error: null, data: { courses: [] } });

    const { default: CourseCatalogClient } = await import(CATALOGUE.replace('src/', '@/').replace('.tsx', ''));
    const view = render(<CourseCatalogClient initial={null} />);

    await waitFor(() => expect(view.container.textContent).toContain('Cocoa Agronomy'));
    return view;
}

/** The category <select>, found by the option only it has. */
function categorySelect(container: HTMLElement): HTMLSelectElement {
    const selects = [...container.querySelectorAll('select')] as HTMLSelectElement[];
    const found = selects.find((s) => [...s.options].some((o) => o.value === 'all' && /All Categories/i.test(o.text)));

    if (!found) throw new Error('no category select on the catalogue');
    return found;
}

beforeEach(() => {
    getCoursesAction.mockReset();
    getEnrolledCoursesWithDetailsAction.mockReset();
    router.push.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#949 — the catalogue can be filtered by category', () => {
    it('THE CONTROL: all three courses are listed before anything is filtered', async () => {
        const { container } = await mountCatalogue();

        expect(container.textContent).toContain('Cocoa Agronomy');
        expect(container.textContent).toContain('Paperwork Abroad');
        expect(container.textContent).toContain('An Older Course');
    });

    it('AND CHOOSING A CATEGORY KEEPS ONLY THE COURSES IN IT', async () => {
        const { container } = await mountCatalogue();

        await act(async () => {
            fireEvent.change(categorySelect(container), { target: { value: 'logistics' } });
        });

        expect(container.textContent).toContain('Cocoa Agronomy');
        expect(container.textContent).not.toContain('Paperwork Abroad');
    });

    it('AND A COURSE STORED WITHOUT A CATEGORY IS IN NONE OF THEM, not in the first', async () => {
        //   The rows written before #930 carry no category. Filing them under a
        //   default would say Export Basics on no evidence — #212's class, a
        //   missing field read as a value.
        const { container } = await mountCatalogue();

        for (const { value } of COURSE_CATEGORIES) {
            await act(async () => {
                fireEvent.change(categorySelect(container), { target: { value } });
            });

            expect({ value, shown: container.textContent?.includes('An Older Course') })
                .toEqual({ value, shown: false });
        }
    });

    it('AND IT COMES BACK UNDER All Categories, which is what makes it reachable', async () => {
        const { container } = await mountCatalogue();

        await act(async () => {
            fireEvent.change(categorySelect(container), { target: { value: 'finance' } });
        });
        expect(container.textContent).not.toContain('An Older Course');

        await act(async () => {
            fireEvent.change(categorySelect(container), { target: { value: 'all' } });
        });
        expect(container.textContent).toContain('An Older Course');
    });

    it('and the five options are the shared list, not five more literals', () => {
        //   academy-course-fields exists because the three LEVELS had been written
        //   out four times and the forms needed a fifth. A hand-typed copy here is
        //   how the catalogue and the admin form start disagreeing about what a
        //   category is.
        const src = code(CATALOGUE);

        expect(src).toContain('COURSE_CATEGORIES.map(');
        for (const { label } of COURSE_CATEGORIES) {
            expect({ label, inlined: src.includes(`>${label}<`) }).toEqual({ label, inlined: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#949 — and the search box found it too', () => {
    it('A SEARCH FOR THE CATEGORY LABEL FINDS THE COURSE', async () => {
        //   "Logistics & Shipping" is what the admin form shows and what a learner
        //   would type. Neither this course's title nor its description says it.
        const { container, getByPlaceholderText } = await mountCatalogue();

        await act(async () => {
            fireEvent.change(getByPlaceholderText(/search/i), { target: { value: 'logistics' } });
        });

        expect(container.textContent).toContain('Cocoa Agronomy');
        expect(container.textContent).not.toContain('Paperwork Abroad');
    });

    it('AND IT IS THE LABEL THAT IS SEARCHED, not the stored slug alone', async () => {
        //   `market-entry` is stored; "Market Entry Strategies" is displayed. A
        //   haystack holding only the slug would match "entry" and not "strategies",
        //   which is the half a learner actually types.
        getCoursesAction.mockResolvedValue({
            success: true, error: null,
            data: [{ ...ROWS[0], id: 'c9', title: 'Selling Into Ghana', description: 'x', category: 'market-entry' }],
        });
        getEnrolledCoursesWithDetailsAction.mockResolvedValue({ success: true, error: null, data: { courses: [] } });

        const { default: CourseCatalogClient } = await import(CATALOGUE.replace('src/', '@/').replace('.tsx', ''));
        const { container, getByPlaceholderText } = render(<CourseCatalogClient initial={null} />);
        await waitFor(() => expect(container.textContent).toContain('Selling Into Ghana'));

        await act(async () => {
            fireEvent.change(getByPlaceholderText(/search/i), { target: { value: 'strategies' } });
        });

        expect(container.textContent).toContain('Selling Into Ghana');
    });

    it('and a search that matches nothing still says so, rather than claiming a failed read', async () => {
        //   #595's guard, re-checked because this change touches the haystack it
        //   reads: the empty state must be "no courses match", not "could not load".
        const { container, getByPlaceholderText } = await mountCatalogue();

        await act(async () => {
            fireEvent.change(getByPlaceholderText(/search/i), { target: { value: 'zzzz-no-such-course' } });
        });

        expect(container.textContent).toMatch(/no courses match your criteria/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#949 — clearing the filters clears this one too', () => {
    it('CLEAR ALL FILTERS RESETS THE CATEGORY, or it cannot be cleared', async () => {
        /*
         *   #595 is the reason this is asserted rather than assumed: that finding
         *   was a learner told to loosen a filter over a list they could not widen.
         *   A filter left out of the reset button is the same defect with a
         *   narrower blast radius — the button appears to work and one selection
         *   survives it.
         */
        const { container, getByText } = await mountCatalogue();

        await act(async () => {
            fireEvent.change(categorySelect(container), { target: { value: 'compliance' } });
        });
        expect(container.textContent).not.toContain('Cocoa Agronomy');

        await act(async () => {
            fireEvent.click(getByText(/clear all filters/i));
        });

        expect(categorySelect(container).value).toBe('all');
        expect(container.textContent).toContain('Cocoa Agronomy');
    });

    it('AND THE BUTTON APPEARS WHEN ONLY THE CATEGORY IS SET', async () => {
        //   Its condition is a disjunction over the filters. A new filter missing
        //   from it leaves the learner with a selection and no visible way out.
        const { container, queryByText } = await mountCatalogue();

        expect(queryByText(/clear all filters/i)).toBeNull();

        await act(async () => {
            fireEvent.change(categorySelect(container), { target: { value: 'compliance' } });
        });

        expect(queryByText(/clear all filters/i)).not.toBeNull();
    });

    it('AND THE EMPTY STATE RESETS IT AS WELL, which is the other way out', async () => {
        const { container, getByText } = await mountCatalogue();

        await act(async () => {
            fireEvent.change(categorySelect(container), { target: { value: 'finance' } });
            fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: 'zzzz' } });
        });
        expect(container.textContent).toMatch(/no courses match your criteria/i);

        await act(async () => {
            fireEvent.click(getByText(/reset search filters/i));
        });

        expect(categorySelect(container).value).toBe('all');
        expect(container.textContent).toContain('Cocoa Agronomy');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#949 — one list of what a category is', () => {
    it('THE SHARED TYPE AND THE SHARED LIST AGREE', () => {
        /*
         *   types/index.ts declared
         *
         *       category?: "export" | "farming" | "business" | "compliance" | string
         *
         *   which says NOTHING: the trailing `| string` admits every value, so the
         *   four names read as a constraint and were decoration. Three of them are
         *   not categories this product has ever offered.
         *
         *   Spelled out there rather than imported, because that module stays free
         *   of academy-specific dependencies — so this is the assertion that keeps
         *   the two from drifting, and it fails on a category added to one of them.
         */
        const shared = code('src/types/index.ts');
        const declared = shared.slice(shared.indexOf('category?: "'), shared.indexOf(';', shared.indexOf('category?: "')));

        for (const { value } of COURSE_CATEGORIES) {
            expect({ value, declared: declared.includes(`"${value}"`) }).toEqual({ value, declared: true });
        }

        //   And the union is a union again, not a `| string` that admits anything.
        expect(declared).not.toContain('| string');
        //   The three that were never offered are gone, rather than kept beside the
        //   real five where the next reader would treat them as live.
        for (const stale of ['"export"', '"farming"', '"business"']) {
            expect({ stale, present: declared.includes(stale) }).toEqual({ stale, present: false });
        }
    });

    it('AND THE COURSE THE CATALOGUE READS DECLARES THE FIELD AT LAST', () => {
        //   Without this the only way to read a stored category was a cast, and a
        //   cast is what hid three session reads in #944.
        const src = code('src/lib/types/academy-actions.ts');

        expect(src).toContain('category?: CourseCategory;');
        expect(code(CATALOGUE)).not.toContain('(course as any).category');
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   matchesCategory left out of the filter's         CHOOSING A CATEGORY KEEPS
 *     return — a <select> that sets state nobody     ONLY THE COURSES IN IT, and
 *     consults, which IS the defect one level up     three more
 *   the category label dropped from the search       A SEARCH FOR THE CATEGORY
 *     haystack                                       LABEL, and IT IS THE LABEL
 *                                                    THAT IS SEARCHED
 *   an absent category defaulted to the first one     A COURSE STORED WITHOUT A
 *     (`course.category || "export-basics"`)         CATEGORY IS IN NONE OF THEM
 *   the reset handlers forget the category            CLEAR ALL FILTERS RESETS
 *                                                    THE CATEGORY, and THE EMPTY
 *                                                    STATE RESETS IT AS WELL
 *   the five options hardcoded instead of mapped      the five options are the
 *     from COURSE_CATEGORIES                         shared list
 *
 *   ALL FIVE CAUGHT. The first is the one worth the render harness: a source
 *   ratchet reading this file would have seen a filter, a select and five
 *   options, and could not have told that the answer went nowhere — which is
 *   exactly the state the screen was in before this change.
 */

