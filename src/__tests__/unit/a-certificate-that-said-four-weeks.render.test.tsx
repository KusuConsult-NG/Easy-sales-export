/**
 * @jest-environment jsdom
 */

/**
 *   #930 EVERY COURSE THE ACADEMY HAS EVER PUBLISHED IS "BEGINNER, 4 WEEKS",
 *        AND THE CERTIFICATE PRINTS IT.
 *
 *   Found auditing src/app/admin/academy/create/page.tsx — one of the files no
 *   test had named.
 *
 *   The create form's payload carried two literals:
 *
 *       level: "beginner",
 *       duration: "4 weeks",
 *
 *   and the form asked for neither. The EDIT screen's courseDetailsForm was
 *   {title, description, instructor, tier}, so there was no second chance: no
 *   screen on this platform could set a course's level or its duration.
 *
 *   Both are read, in five places, and one of them is a document:
 *
 *       CourseCatalogClient   the level FILTER — `course.level === selectedLevel`
 *       CourseCatalogClient   the level badge and the duration on the card
 *       CourseDetailClient    both, on the course page
 *       CertificateClient     `{course.duration}` — on the learner's certificate
 *
 *   So a twelve-week advanced masterclass is listed as Beginner, 4 weeks; a
 *   learner filtering for "advanced" can never match anything, because every
 *   course in the catalogue holds the same single value; and the certificate she
 *   shows an employer attests a duration nobody ever entered.
 *
 * ── AND THE CATEGORY SELECT WAS DECORATION ──────────────────────────────────
 *
 *   Five options, written into form state by its onChange, and absent from the
 *   object handed to createCourseAction. lib/validations/course has admitted
 *   `category` since the tier fix — its header says "the create page sends
 *   both" — and the page sends tier. The other half was dropped on the floor by
 *   the caller, which is this file's own history repeating: the thumbnail
 *   "upload placeholder" that was a styled div with no input, recorded in the
 *   page's header.
 *
 *   Nothing reads `course.category` yet, so it is RECORDED rather than
 *   displayed. That is a smaller wrong than a select which discards the answer
 *   it asked for, and a category filter needs a reader — the owner's call.
 *
 *   #949 IT HAS ONE, and calling it the owner's call was overcautious: the
 *   catalogue panel already filtered on level and on tier, both stored by this
 *   same form in this same submit, so the category filter was the third of three.
 *   a-category-nobody-could-search covers it by mounting the catalogue.
 *
 * ── WHY THIS MOUNTS BOTH FORMS ──────────────────────────────────────────────
 *
 *   A source ratchet cannot tell a field that renders from a field that is
 *   merely in the file. This types a duration, picks a level, submits, and reads
 *   back the payload the action actually receives.
 *
 *   THE GLOBAL `jest`, not `@jest/globals`: the subjects are imported
 *   statically and #392's mechanism is that importing jest from the package
 *   defeats jest.mock hoisting.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { COURSE_LEVELS, COURSE_CATEGORIES } from '@/lib/academy-course-fields';
import { createCourseSchema } from '@/lib/validations/course';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

const CREATE = 'src/app/admin/academy/create/page.tsx';
const EDIT = 'src/app/admin/academy/[courseId]/page.tsx';

const mockCreateCourse = jest.fn() as jest.Mock<any>;
const mockGetCourseById = jest.fn() as jest.Mock<any>;
const mockUpdateCourse = jest.fn() as jest.Mock<any>;
const mockUpdateModules = jest.fn() as jest.Mock<any>;
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, back: jest.fn(), refresh: jest.fn() }),
    useParams: () => ({ courseId: 'course-1' }),
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('sonner', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
//   Required AFTER the factory above so these ARE the mocked spies.
const { toast } = require('sonner') as { toast: { success: jest.Mock; error: jest.Mock } };

jest.mock('@/hooks/use-storage', () => ({
    useStorage: () => ({ uploadFile: jest.fn(async () => 'https://cdn.test/thumb.jpg'), uploadState: {} }),
}));

jest.mock('@/app/actions/academy', () => ({
    createCourseAction: (...a: any[]) => mockCreateCourse(...a),
    getCourseByIdAction: (...a: any[]) => mockGetCourseById(...a),
    updateCourseAction: (...a: any[]) => mockUpdateCourse(...a),
    updateCourseModulesAction: (...a: any[]) => mockUpdateModules(...a),
}));

import CreateCoursePage from '@/app/admin/academy/create/page';
import CourseManagerPage from '@/app/admin/academy/[courseId]/page';

/** A course as the database actually holds one, after this finding. */
const STORED_COURSE = {
    id: 'course-1',
    title: 'Export Documentation Masterclass',
    description: 'Everything a first-time exporter has to file, in order.',
    instructor: 'Dr. Kusu',
    tier: 'elite',
    level: 'advanced',
    duration: '12 weeks',
    category: 'compliance',
    modules: [],
    thumbnail: '',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockCreateCourse.mockResolvedValue({ success: true, data: { id: 'new-course' } });
    mockUpdateCourse.mockResolvedValue({ success: true, data: null });
    mockGetCourseById.mockResolvedValue({ success: true, data: STORED_COURSE });
});

/** The select offering the three levels, found by what it offers. */
function levelSelect(): HTMLSelectElement {
    const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    const found = selects.find((s) => {
        const values = Array.from(s.options).map((o) => o.value);
        return COURSE_LEVELS.every((l) => values.includes(l));
    });
    if (!found) throw new Error('no level select on screen');
    return found;
}

function durationBox(): HTMLInputElement {
    const box = document.querySelector('input[placeholder="e.g., 6 weeks"]') as HTMLInputElement | null;
    if (!box) throw new Error('no duration box on screen');
    return box;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#930 — the five readers, measured rather than remembered', () => {
    it('THE CATALOGUE FILTERS ON LEVEL AND PRINTS THE DURATION', () => {
        const catalogue = code('src/app/academy/(learner)/courses/CourseCatalogClient.tsx');

        expect(catalogue).toContain('course.level === selectedLevel');
        expect(catalogue).toContain('{course.duration}');
    });

    it('THE COURSE PAGE SHOWS BOTH', () => {
        const detail = code('src/app/academy/[courseId]/CourseDetailClient.tsx');

        expect(detail).toContain('course.level');
        expect(detail).toContain('{course.duration}');
    });

    it('AND THE CERTIFICATE PRINTS THE DURATION — the one that leaves the building', () => {
        //   The sharpest consequence: a document a learner hands an employer,
        //   attesting a figure no screen could set.
        const certificate = code('src/app/academy/certificate/[certificateId]/CertificateClient.tsx');

        expect(certificate).toContain('{course.duration}');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#930 — the schema had already been widened for this', () => {
    it('IT ACCEPTS LEVEL, DURATION AND CATEGORY, and keeps all three', () => {
        const parsed = createCourseSchema.parse({
            title: 'Export Documentation Masterclass',
            description: 'Everything a first-time exporter has to file, in order.',
            instructor: 'Dr. Kusu',
            duration: '12 weeks',
            level: 'advanced',
            tier: 'elite',
            category: 'compliance',
        });

        expect(parsed.duration).toBe('12 weeks');
        expect(parsed.level).toBe('advanced');
        expect(parsed.category).toBe('compliance');
    });

    it('AND STILL REQUIRES the two the form used to invent', () => {
        //   The control on the `required` attributes below: if the schema let
        //   these through, asking for them would be politeness rather than
        //   correctness.
        const base = {
            title: 'Export Documentation Masterclass',
            description: 'Everything a first-time exporter has to file, in order.',
            instructor: 'Dr. Kusu',
            tier: 'elite' as const,
        };

        expect(createCourseSchema.safeParse({ ...base, level: 'advanced' }).success).toBe(false);
        expect(createCourseSchema.safeParse({ ...base, duration: '12 weeks' }).success).toBe(false);
        expect(createCourseSchema.safeParse({ ...base, level: 'expert', duration: '12 weeks' }).success)
            .toBe(false);
    });

    it('and its level enum is the shared list, not a fifth spelling', () => {
        for (const level of COURSE_LEVELS) {
            expect({ level, ok: createCourseSchema.safeParse({
                title: 'Export Documentation Masterclass',
                description: 'Everything a first-time exporter has to file, in order.',
                instructor: 'Dr. Kusu',
                duration: '12 weeks',
                level,
            }).success }).toEqual({ level, ok: true });
        }
        expect([...COURSE_LEVELS]).toEqual(['beginner', 'intermediate', 'advanced']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#930 — the create form asks, and sends what it was told', () => {
    it('IT OFFERS THE THREE LEVELS AND A DURATION BOX', async () => {
        render(<CreateCoursePage />);

        expect(Array.from(levelSelect().options).map((o) => o.value)).toEqual([...COURSE_LEVELS]);
        expect(durationBox()).toBeInTheDocument();
        //   Required, because the schema requires it — a course stored without
        //   one is the state this finding is about.
        expect(durationBox().required).toBe(true);
    });

    it('AND THE PAYLOAD CARRIES THE ADMIN’S ANSWERS, not two literals', async () => {
        const user = userEvent.setup();
        render(<CreateCoursePage />);

        await user.type(screen.getByPlaceholderText(/Export Documentation Masterclass/i),
            'Export Documentation Masterclass');
        await user.type(screen.getByPlaceholderText(/What will students learn/i),
            'Everything a first-time exporter has to file, in order.');
        await user.type(screen.getByPlaceholderText(/Dr\. Kusu/i), 'Dr. Kusu');
        await user.type(durationBox(), '12 weeks');
        await user.selectOptions(levelSelect(), 'advanced');

        const categorySelect = Array.from(document.querySelectorAll('select'))
            .find((s) => Array.from((s as HTMLSelectElement).options)
                .some((o) => o.value === 'compliance')) as HTMLSelectElement;
        await user.selectOptions(categorySelect, 'compliance');

        await user.click(screen.getByRole('button', { name: /create course/i }));

        await waitFor(() => expect(mockCreateCourse).toHaveBeenCalled());

        const payload = mockCreateCourse.mock.calls[0][0];
        expect(payload.level).toBe('advanced');
        expect(payload.duration).toBe('12 weeks');
        //   The select's answer, which the caller used to drop.
        expect(payload.category).toBe('compliance');
    });

    it('AND THE PAYLOAD WOULD PASS THE SCHEMA — the round trip', async () => {
        //   Asserting the shape the server will actually validate, rather than
        //   trusting that two correct-looking fields are the right two.
        const user = userEvent.setup();
        render(<CreateCoursePage />);

        await user.type(screen.getByPlaceholderText(/Export Documentation Masterclass/i),
            'Export Documentation Masterclass');
        await user.type(screen.getByPlaceholderText(/What will students learn/i),
            'Everything a first-time exporter has to file, in order.');
        await user.type(screen.getByPlaceholderText(/Dr\. Kusu/i), 'Dr. Kusu');
        await user.type(durationBox(), '12 weeks');
        await user.click(screen.getByRole('button', { name: /create course/i }));

        await waitFor(() => expect(mockCreateCourse).toHaveBeenCalled());

        const check = createCourseSchema.safeParse(mockCreateCourse.mock.calls[0][0]);
        expect(check.success).toBe(true);
    });

    it('POSITIVE CONTROL: the literals are gone from the payload', () => {
        //   On STRIPPED source — the page's own comments quote the two literals
        //   deliberately, and a raw read would count the explanation as the
        //   defect. #918 was refused twice for exactly that.
        const src = code(CREATE);

        expect(src).not.toContain('level: "beginner"');
        expect(src).not.toContain('duration: "4 weeks"');
        expect(src).toContain('level: formData.level');
        expect(src).toContain('duration: formData.duration');
        expect(src).toContain('category: formData.category');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#930 — and the edit form can correct a course already stored', () => {
    const openSettings = async () => {
        const user = userEvent.setup();
        render(<CourseManagerPage />);
        await waitFor(() => expect(mockGetCourseById).toHaveBeenCalled());
        await user.click(await screen.findByRole('button', { name: /edit details/i }));
        return user;
    };

    it('IT LOADS WHAT THE CATALOGUE IS SHOWING, not a default', async () => {
        //   An admin deciding what to change has to see the stored value. A
        //   form that opened on "beginner" would invite them to save the very
        //   figure this finding is about.
        await openSettings();

        expect(levelSelect().value).toBe('advanced');
        expect(durationBox().value).toBe('12 weeks');
    });

    it('AND A CORRECTION REACHES THE SERVER', async () => {
        const user = await openSettings();

        await user.selectOptions(levelSelect(), 'intermediate');
        await user.clear(durationBox());
        await user.type(durationBox(), '8 weeks');
        await user.click(screen.getByRole('button', { name: /save details/i }));

        await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalled());

        const [courseId, patch] = mockUpdateCourse.mock.calls[0];
        expect(courseId).toBe('course-1');
        expect(patch.level).toBe('intermediate');
        expect(patch.duration).toBe('8 weeks');
        //   And the fields it always carried are still there.
        expect(patch.title).toBe(STORED_COURSE.title);
        expect(patch.tier).toBe('elite');
    });

    it('and the patch would pass the partial schema the action validates against', async () => {
        const user = await openSettings();
        await user.click(screen.getByRole('button', { name: /save details/i }));

        await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalled());

        const check = createCourseSchema.partial().safeParse(mockUpdateCourse.mock.calls[0][1]);
        expect(check.success).toBe(true);
    });

    it('AND A BLANK DURATION IS REFUSED BEFORE THE ROUND TRIP', async () => {
        /*
         *   A course stored by the OTHER creator may hold no duration, and the
         *   field is required — so an admin who opened this to change the title
         *   would have had the whole patch refused with the schema's "Duration
         *   is required" and no clue which box it meant.
         */
        mockGetCourseById.mockResolvedValue({
            success: true, data: { ...STORED_COURSE, duration: '' },
        });

        const user = await openSettings();
        await user.click(screen.getByRole('button', { name: /save details/i }));

        expect(mockUpdateCourse).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('How long is this course?'));
    });

    it('POSITIVE CONTROL: the stripper left both screens behind', () => {
        expect(code(CREATE).length).toBeGreaterThan(3_000);
        expect(code(EDIT).length).toBeGreaterThan(10_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#930 — one vocabulary for both forms', () => {
    it('THE CATEGORIES ARE A SHARED LIST, rendered from it', () => {
        expect(COURSE_CATEGORIES.map((c) => c.value)).toEqual([
            'export-basics', 'compliance', 'logistics', 'market-entry', 'finance',
        ]);

        for (const rel of [CREATE, EDIT]) {
            expect({ rel, maps: code(rel).includes('COURSE_CATEGORIES.map(') })
                .toEqual({ rel, maps: true });
            expect({ rel, maps: code(rel).includes('COURSE_LEVELS.map(') })
                .toEqual({ rel, maps: true });
        }
    });

    it('AND NEITHER FORM WRITES AN <option> FOR A LEVEL BY HAND', () => {
        for (const rel of [CREATE, EDIT]) {
            const src = code(rel);
            for (const level of COURSE_LEVELS) {
                expect({ rel, level, hardcoded: src.includes(`<option value="${level}"`) })
                    .toEqual({ rel, level, hardcoded: false });
            }
        }
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   restore `level: "beginner", duration: "4 weeks"` "THE PAYLOAD CARRIES THE
 *     in the create payload (the defect)            ADMIN'S ANSWERS" and the
 *                                                   positive control
 *   drop `category: formData.category` again        the same test
 *   remove the Duration input from the create form  "IT OFFERS THE THREE LEVELS
 *                                                   AND A DURATION BOX"
 *   drop `required` from the duration input         the same test
 *   load the edit form on DEFAULT_COURSE_LEVEL      "IT LOADS WHAT THE
 *     rather than the stored level                  CATALOGUE IS SHOWING"
 *   drop level/duration from the edit patch         "AND A CORRECTION REACHES
 *                                                   THE SERVER"
 *   make `duration` optional in the schema          "AND STILL REQUIRES the two
 *                                                   the form used to invent"
 *   add a fourth level to COURSE_LEVELS            "its level enum is the
 *                                                   shared list"
 */
