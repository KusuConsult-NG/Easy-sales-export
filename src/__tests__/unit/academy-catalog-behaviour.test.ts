/**
 * @jest-environment node
 */

/**
 * academy/_ac_catalog.ts, EXECUTED. It was at 14.2%.
 *
 *   #211 THE ADMIN "CREATE COURSE" BUTTON HAD NEVER CREATED A COURSE.
 *
 *        createCourseSchema required `price`, and /admin/academy/create sends
 *        none — it has no price field at all, not in its form state and not in
 *        its payload. safeParse therefore failed on EVERY submission and
 *        _createCourseAction returned the first issue's message, which the page
 *        raised as a toast:
 *
 *            "Invalid input: expected number, received undefined"
 *
 *        Price is optional now, defaulting to 0. That is the meaningful value:
 *        price gates only the INDIVIDUAL course purchase —
 *        _ac_course_payment refuses to charge when `!course.price` — while
 *        access is decided by tier.
 *
 *   #212 AND THE TIER THE FORM COLLECTS WAS BEING THROWN AWAY.
 *        `tier` and `category` were absent from the schema, and Zod strips
 *        unknown keys. So even with the price fixed, a course created through
 *        the admin form would store NO tier — and checkCourseAccess treats an
 *        absent tier as open to everybody, signed in or not:
 *
 *            if (!tier || tier === "free") return true;
 *
 *        An admin choosing "elite" would have published a course free to every
 *        visitor, videos included, through getCourseByIdAction. Both fields now
 *        match `courseSchema` in lib/schemas.ts — the OTHER schema for this same
 *        entity, used by _ac_admin_catalog.ts's upsert, which has always had
 *        tier. Two schemas for one course, and the live create path used the
 *        half missing the access control.
 *
 *   #213 createCourseAction HAD NO ADMIN GATE.
 *        It checked `session?.user?.id` and nothing else, so any signed-in
 *        account could create a course — and the createAdminAuditLog beside it
 *        recorded that as an admin action naming the caller. The audit ratchet
 *        could not see it either: admin-action-audit-trail matches
 *        `hasAdminPermission(` or `requireAdmin(`, and a file using neither is
 *        never inspected. #190's blind spot in a third form — a gate so weak
 *        the ratchet did not recognise the file as gated at all.
 *
 *   #214 AND THE OTHER THREE LOCKED OUT THE ACADEMY ADMIN.
 *        update, updateModules and delete each used a hand-written
 *        `admin || super_admin`; `academy_admin` is in neither, while the READ
 *        beside them uses isAdmin(), which admits all ten roles. The academy
 *        admin could open the course editor, see every quiz answer, and save
 *        nothing. The other implementation of the same write already gates on
 *        academy:manage_courses, so the two paths disagreed about who may edit
 *        a course.
 *
 *   #215 updateCourseAction WROTE ANY FIELD THE CALLER NAMED.
 *        `{ ...data, updatedAt }` with `data: Partial<Course>` — a TypeScript
 *        annotation, which is nothing at a server-action boundary. `tier`,
 *        `status`, `instructorId`, `studentsCount` and `createdAt` were all
 *        writable. Its sibling validates; this one, the path the editor calls,
 *        did not. #43/#45's family.
 *
 *   #216 AND THE LIST REPORTED A PAGE THAT WAS NOT THERE.
 *        `hasMore = snapshot.docs.length === limit` over a query of exactly
 *        `limit` rows — true on the LAST page whenever the catalogue size is an
 *        exact multiple of the page size, so "load more" returned nothing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { createCourseSchema } from '@/lib/validations/course';
import { checkCourseAccess } from '@/lib/academy-plan';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;
const COURSES = COLLECTIONS.ACADEMY_COURSES;

const catalog = async () => await import('@/app/actions/academy/_ac_catalog');

const sessionFor = (roles: string[]) => ({
    session: { user: { id: 'admin-1', email: 'a@e.com', roles } },
});

/**
 * The payload /admin/academy/create actually sends — copied field for field
 * from its handleSubmit, including the absence of `price`.
 */
const CREATE_PAGE_PAYLOAD = {
    title: 'Export Basics 101',
    description: 'Everything a first-time exporter needs to know before shipping.',
    instructor: 'Ada Lovelace',
    thumbnail: '',
    tier: 'elite',
    level: 'beginner',
    duration: '4 weeks',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireSession.mockResolvedValue(sessionFor(['super_admin']));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#211 — the create form can create a course', () => {
    it('ACCEPTS THE PAYLOAD THE ADMIN PAGE ACTUALLY SENDS', async () => {
        const res = await (await catalog()).createCourseAction(CREATE_PAGE_PAYLOAD) as any;

        // Was: false, with "Invalid input: expected number, received undefined".
        expect(res.success).toBe(true);
        expect(store.size(COURSES)).toBe(1);
    });

    it('defaults the price to 0, which is "not individually purchasable"', async () => {
        await (await catalog()).createCourseAction(CREATE_PAGE_PAYLOAD);

        const [[, course]] = store.all(COURSES);
        expect(course.price).toBe(0);
    });

    it('still refuses a payload that is genuinely invalid', async () => {
        const res = await (await catalog()).createCourseAction({
            ...CREATE_PAGE_PAYLOAD, title: 'x',
        }) as any;

        expect(res.success).toBe(false);
        expect(store.size(COURSES)).toBe(0);
    });

    it('still refuses a negative price', async () => {
        const res = await (await catalog()).createCourseAction({
            ...CREATE_PAGE_PAYLOAD, price: -1,
        }) as any;

        expect(res.success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#212 — the tier survives, so the course is not free to everybody', () => {
    it('STORES THE TIER THE ADMIN CHOSE', async () => {
        await (await catalog()).createCourseAction(CREATE_PAGE_PAYLOAD);

        const [[, course]] = store.all(COURSES);
        // Was: absent. Zod strips unknown keys and `tier` was not in the schema.
        expect(course.tier).toBe('elite');
        expect(course.category).toBeUndefined();  // not sent by this payload
    });

    it('AND THAT TIER ACTUALLY LOCKS THE COURSE', async () => {
        await (await catalog()).createCourseAction(CREATE_PAGE_PAYLOAD);
        const [[, course]] = store.all(COURSES);

        // The point of the whole fix: with no tier stored, every one of these
        // was true — an elite course served to a signed-out visitor.
        expect(checkCourseAccess(undefined, course.tier)).toBe(false);
        expect(checkCourseAccess('foundation', course.tier)).toBe(false);
        expect(checkCourseAccess('standard', course.tier)).toBe(false);
        expect(checkCourseAccess('elite', course.tier)).toBe(true);
    });

    it('keeps the category when the caller sends one', async () => {
        await (await catalog()).createCourseAction({
            ...CREATE_PAGE_PAYLOAD, category: 'export-basics',
        });

        expect(store.all(COURSES)[0][1].category).toBe('export-basics');
    });

    it('the schema agrees with courseSchema about the tier vocabulary', async () => {
        const { courseSchema } = await import('@/lib/schemas');
        // Both describe one entity. The values and the default must match, or
        // which of the two an operation happens to use decides who can read the
        // course.
        for (const tier of ['free', 'foundation', 'standard', 'elite']) {
            expect(`${tier}: ${createCourseSchema.safeParse({ ...CREATE_PAGE_PAYLOAD, tier }).success}`)
                .toBe(`${tier}: true`);
        }
        expect(createCourseSchema.safeParse({ ...CREATE_PAGE_PAYLOAD, tier: 'platinum' }).success)
            .toBe(false);

        const noTier = createCourseSchema.parse({ ...CREATE_PAGE_PAYLOAD, tier: undefined });
        const siblingDefault = (courseSchema as any).shape.tier;
        expect(noTier.tier).toBe('free');
        expect(siblingDefault).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#213/#214 — who may write a course', () => {
    const create = async () =>
        (await catalog()).createCourseAction(CREATE_PAGE_PAYLOAD) as any;

    it('REFUSES AN ORDINARY SIGNED-IN ACCOUNT', async () => {
        mockRequireSession.mockResolvedValue(sessionFor(['user']));

        // Was: success. Any logged-in account could add a course to the
        // catalogue, and the audit row called it an admin action.
        expect(await create()).toMatchObject({ success: false });
        expect(store.size(COURSES)).toBe(0);
    });

    it.each([['support'], ['moderator'], ['marketplace_admin'], ['wave_admin']])(
        'refuses %s', async (role) => {
            mockRequireSession.mockResolvedValue(sessionFor([role]));
            expect(await create()).toMatchObject({ success: false });
            expect(store.size(COURSES)).toBe(0);
        });

    it.each([['super_admin'], ['admin'], ['academy_admin']])(
        'admits %s, who holds academy:manage_courses', async (role) => {
            mockRequireSession.mockResolvedValue(sessionFor([role]));
            expect(await create()).toMatchObject({ success: true });
        });

    it('ADMITS THE ACADEMY ADMIN TO THE EDITOR IT CAN ALREADY READ', async () => {
        store.seed(COURSES, 'c1', { title: 'Old title', tier: 'foundation' });
        mockRequireSession.mockResolvedValue(sessionFor(['academy_admin']));

        const res = await (await catalog()).updateCourseAction('c1', {
            title: 'A brand new title',
        } as never) as any;

        // Was: "Unauthorized" — the academy admin could see every quiz answer
        // through the list and save nothing.
        expect(res.success).toBe(true);
        expect(store.get(COURSES, 'c1')?.title).toBe('A brand new title');
    });

    it('admits the academy admin to updateCourseModules and delete', async () => {
        store.seed(COURSES, 'c1', { title: 'A course' });
        mockRequireSession.mockResolvedValue(sessionFor(['academy_admin']));
        const { updateCourseModulesAction, deleteCourseAction } = await catalog();

        expect(await updateCourseModulesAction('c1', [] as never)).toMatchObject({ success: true });
        expect(await deleteCourseAction('c1')).toMatchObject({ success: true });
        expect(store.get(COURSES, 'c1')).toBeUndefined();
    });

    it.each([['support'], ['user']])('still refuses %s on update and delete', async (role) => {
        store.seed(COURSES, 'c1', { title: 'A course' });
        mockRequireSession.mockResolvedValue(sessionFor([role]));
        const { updateCourseAction, deleteCourseAction } = await catalog();

        expect(await updateCourseAction('c1', { title: 'Hijacked title here' } as never))
            .toMatchObject({ success: false });
        expect(await deleteCourseAction('c1')).toMatchObject({ success: false });
        expect(store.get(COURSES, 'c1')?.title).toBe('A course');
    });

    it('refuses a caller with no session', async () => {
        mockRequireSession.mockResolvedValue({ session: null });
        expect(await create()).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#215 — the update writes only what it validates', () => {
    beforeEach(() => {
        store.seed(COURSES, 'c1', {
            title: 'A real course title', tier: 'elite', status: 'draft',
            instructorId: 'instructor-1', studentsCount: 40,
        });
    });

    it('DOES NOT WRITE A FIELD THE SCHEMA DOES NOT NAME', async () => {
        const res = await (await catalog()).updateCourseAction('c1', {
            title: 'A perfectly fine new title',
            status: 'published',
            instructorId: 'somebody-else',
            studentsCount: 999999,
        } as never) as any;

        expect(res.success).toBe(true);
        const course = store.get(COURSES, 'c1')!;
        expect(course.title).toBe('A perfectly fine new title');
        // Was: all three overwritten by whatever the caller sent.
        expect(course.status).toBe('draft');
        expect(course.instructorId).toBe('instructor-1');
        expect(course.studentsCount).toBe(40);
    });

    it('STILL SAVES THE TIER, which is what the editor exists to change', async () => {
        // The trap in this fix: validating against the OLD schema would have
        // silently dropped `tier`, turning an access-control defect into a
        // "the editor does not save" one.
        const res = await (await catalog()).updateCourseAction('c1', {
            tier: 'foundation',
        } as never) as any;

        expect(res.success).toBe(true);
        expect(store.get(COURSES, 'c1')?.tier).toBe('foundation');
    });

    it('saves the whole payload the editor sends', async () => {
        await (await catalog()).updateCourseAction('c1', {
            title: 'Advanced Export Logistics',
            description: 'A description that is comfortably over twenty characters.',
            instructor: 'Grace Hopper',
            tier: 'standard',
        } as never);

        expect(store.get(COURSES, 'c1')).toMatchObject({
            title: 'Advanced Export Logistics',
            instructor: 'Grace Hopper',
            tier: 'standard',
        });
    });

    it('refuses an invalid value rather than writing it', async () => {
        const res = await (await catalog()).updateCourseAction('c1', {
            tier: 'platinum',
        } as never) as any;

        expect(res.success).toBe(false);
        expect(store.get(COURSES, 'c1')?.tier).toBe('elite');
    });

    it('records the edit against the admin who made it', async () => {
        await (await catalog()).updateCourseAction('c1', { title: 'Another good title' } as never);

        expect((globalThis as any).mockCreateAdminAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'course_updated', userId: 'admin-1', targetId: 'c1' }),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#216 — the list does not offer a page it cannot deliver', () => {
    const seedCourses = (n: number) => {
        for (let i = 0; i < n; i++) {
            store.seed(COURSES, `c${String(i).padStart(2, '0')}`, {
                title: `Course ${i}`, tier: 'free',
                createdAt: new Date(Date.UTC(2026, 0, 100 - i)).toISOString(),
            });
        }
    };

    it('SAYS THERE IS NO MORE WHEN THE COUNT IS AN EXACT MULTIPLE OF THE PAGE', async () => {
        seedCourses(4);

        const res = await (await catalog()).getCoursesAction(4) as any;

        expect(res.data).toHaveLength(4);
        // Was true, and the next page came back empty.
        expect(res.hasMore).toBe(false);
        expect(res.lastDocId).toBeNull();
    });

    it('says there is more when there genuinely is', async () => {
        seedCourses(5);

        const res = await (await catalog()).getCoursesAction(4) as any;

        expect(res.data).toHaveLength(4);
        expect(res.hasMore).toBe(true);
        expect(res.lastDocId).toBeTruthy();
    });

    it('walks the catalogue without repeating or losing a course', async () => {
        seedCourses(7);
        const { getCoursesAction } = await catalog();

        const seen: string[] = [];
        let cursor: string | undefined;
        for (let guard = 0; guard < 10; guard++) {
            const page: any = await getCoursesAction(3, cursor);
            seen.push(...page.data.map((c: any) => c.title));
            if (!page.hasMore) break;
            cursor = page.lastDocId;
        }

        expect(new Set(seen).size).toBe(7);
    });

    it('still strips the answer key for a learner', async () => {
        store.seed(COURSES, 'c1', {
            title: 'Quiz course', tier: 'free',
            createdAt: '2026-01-01T00:00:00.000Z',
            modules: [{ id: 'm1', quiz: { questions: [{ q: 'a?', correctAnswer: 'b' }] } }],
        });
        mockRequireSession.mockResolvedValue(sessionFor(['user']));

        const res = await (await catalog()).getCoursesAction(10) as any;

        expect(JSON.stringify(res.data)).not.toContain('correctAnswer');
    });
});
