/**
 * The vocabulary a course is described in — #930.
 *
 *   THE ADMIN CREATE FORM HARDCODED TWO FIELDS THAT FIVE SCREENS DISPLAY, AND
 *   NO SCREEN ON THE PLATFORM COULD SET EITHER.
 *
 *   `/admin/academy/create` sent `level: "beginner"` and `duration: "4 weeks"`
 *   as literals, on every course ever made through it, and asked for neither.
 *   The edit screen's `courseDetailsForm` is `{title, description, instructor,
 *   tier}` — so there was no second chance. Both fields are read:
 *
 *       CourseCatalogClient   the level FILTER, the level badge, the duration
 *       CourseDetailClient    the level and the duration on the course page
 *       CertificateClient     `{course.duration}` — printed on the certificate
 *
 *   A twelve-week advanced masterclass was listed as Beginner, 4 weeks; the
 *   learner's "advanced" filter could never match anything; and the certificate
 *   she shows an employer attests a duration nobody ever entered.
 *
 *   AND THE SCHEMA HAD ALREADY BEEN WIDENED FOR THIS. validations/course's
 *   header records the earlier half of the same story — "the tier the form
 *   collects was being thrown away", fixed by admitting `tier` and `category` —
 *   and says "the create page sends both". It sends tier. `category` is chosen
 *   from a five-option select and dropped on the floor by the caller, which is
 *   the same defect one field along.
 *
 * ── WHY A SHARED MODULE RATHER THAN A FIFTH SPELLING ────────────────────────
 *
 *   The three levels were written out four times — lib/types/academy,
 *   lib/types/academy-actions, lib/validations/course and lib/schemas — and the
 *   forms needed a fifth to render a <select>. They agree today; this is what
 *   keeps them agreeing, and the zod enums are built from it rather than beside
 *   it.
 *
 * Pure data: no imports, no I/O, safe anywhere.
 */

/** The three levels, in the order a form should offer them. */
export const COURSE_LEVELS = ["beginner", "intermediate", "advanced"] as const;

export type CourseLevel = (typeof COURSE_LEVELS)[number];

/**
 * The categories the create form has always offered.
 *
 *   KEPT, AND NOW ACTUALLY SENT. Nothing READS `course.category` yet — the
 *   catalogue filters on level and tier — so this is recorded rather than
 *   displayed, which is a smaller wrong than a select that discards the answer
 *   it asked for. A category filter is a product decision and needs a reader;
 *   until there is one, the value is at least on the row for it to read.
 */
export const COURSE_CATEGORIES = [
    { value: "export-basics", label: "Export Basics" },
    { value: "compliance", label: "Compliance & Legal" },
    { value: "logistics", label: "Logistics & Shipping" },
    { value: "market-entry", label: "Market Entry Strategies" },
    { value: "finance", label: "Finance & Payment" },
] as const;

export type CourseCategory = (typeof COURSE_CATEGORIES)[number]["value"];

/**
 * The default a form starts on.
 *
 * NOT a default the SERVER applies. `level` stays required in the schema on
 * purpose: a course stored without one is the state this finding is about, and
 * a server-side default would let the next caller reintroduce it silently.
 */
export const DEFAULT_COURSE_LEVEL: CourseLevel = "beginner";
export const DEFAULT_COURSE_CATEGORY: CourseCategory = "export-basics";
