import { z } from 'zod';

// Course Progress Update Schema
export const courseProgressSchema = z.object({
    courseId: z.string().min(1, 'Course ID is required'),
    lessonId: z.string().min(1, 'Lesson ID is required'),
    progressPercent: z.number().min(0).max(100),
    lastWatchedSecond: z.number().min(0),
    completed: z.boolean().optional(),
});

export type CourseProgressInput = z.infer<typeof courseProgressSchema>;

// Course Enrollment Schema
export const courseEnrollmentSchema = z.object({
    courseId: z.string().min(1, 'Course ID is required'),
});

export type CourseEnrollmentInput = z.infer<typeof courseEnrollmentSchema>;

/**
 * Create Course Schema.
 *
 * THE ADMIN "CREATE COURSE" BUTTON HAD NEVER CREATED A COURSE
 * ----------------------------------------------------------
 * `price` was required and /admin/academy/create sends no price — it has no
 * price field at all, not in its form state and not in its payload. So
 * safeParse failed on EVERY submission and _createCourseAction returned the
 * first issue's message, which the page showed as a toast:
 *
 *     "Invalid input: expected number, received undefined"
 *
 * It is optional now, defaulting to 0. That is the meaningful value: price
 * gates only the INDIVIDUAL course purchase — _ac_course_payment refuses to
 * charge when `!course.price || course.price <= 0` — while access is decided by
 * `tier`. A course with no price is one included in the learner's plan.
 *
 * AND THE TIER THE FORM COLLECTS WAS BEING THROWN AWAY
 * ---------------------------------------------------
 * `tier` and `category` were absent here, and Zod strips unknown keys. The
 * create page sends both; neither survived validation, so the stored course had
 * no tier — and checkCourseAccess treats an absent tier as OPEN TO EVERYBODY,
 * signed in or not. An admin choosing "elite" would have published a course
 * free to every visitor, videos included, through getCourseByIdAction.
 *
 * Both fields match `courseSchema` in lib/schemas.ts, which is the OTHER schema
 * for this same entity — used by _ac_admin_catalog.ts's upsert. That one has
 * always had `tier`. Two schemas for one course, and the live create path used
 * the half that was missing the access control.
 */
export const createCourseSchema = z.object({
    title: z.string().min(5, "Title must be at least 5 characters"),
    description: z.string().min(20, "Description must be at least 20 characters"),
    instructor: z.string().min(2, "Instructor name is required"),
    duration: z.string().min(1, "Duration is required"), // e.g., "4 weeks"
    level: z.enum(["beginner", "intermediate", "advanced"]),
    // Same values and same default as courseSchema — one entity, one vocabulary.
    tier: z.enum(["free", "foundation", "standard", "elite"]).optional().default("free"),
    category: z.string().min(1).optional(),
    price: z.number().min(0, "Price cannot be negative").optional().default(0),
    thumbnail: z.string().url("Invalid thumbnail URL").optional().or(z.literal("")),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
