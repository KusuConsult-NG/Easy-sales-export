import { z } from "zod";
import { dateSchema, applicationEmail } from "./shared";

/**
 * Academy Application & Enrollment Schemas
 * Ensures strict integrity for LMS participants and legacy academy migrations.
 */

export const AcademyApplicationSchema = z.object({
    id: z.string(),
    userId: z.string(),
    userEmail: z.string().optional(),
    fullName: z.string().default(""),
    phone: z.string().default(""),
    state: z.string().default(""),
    plan: z.enum(["foundation", "standard", "elite"]).default("foundation"),
    status: z.enum(["pending", "approved", "rejected", "enrolled"]).default("pending"),
    paymentStatus: z.enum(["pending", "completed", "failed"]).default("pending"),
    paymentReference: z.string().optional(),
    enrolledAt: dateSchema.optional(),
    submittedAt: dateSchema,
    createdAt: dateSchema,
    updatedAt: dateSchema.optional(),
    reviewedBy: z.string().optional(),
    rejectionReason: z.string().optional(),
    _version: z.number().default(1),
});

export type AcademyApplication = z.infer<typeof AcademyApplicationSchema>;

/**
 * Course Enrollment Schema
 */
export const CourseEnrollmentSchema = z.object({
    id: z.string(),
    userId: z.string(),
    courseId: z.string(),
    status: z.enum(["active", "completed", "expired"]).default("active"),
    progress: z.number().min(0).max(100).default(0),
    enrolledAt: dateSchema,
    lastAccessedAt: dateSchema.optional(),
    completedAt: dateSchema.optional(),
    certificateId: z.string().optional(),
    _version: z.number().default(1),
});

/**
 * A field the application form marks required, so the schema says so too.
 *
 *   #942 THE FORM SAID REQUIRED AND THE SCHEMA ACCEPTED A BLANK.
 *
 *   Nine fields in PersonalInfoStep carry `required`; eight of them were bare
 *   `z.string()`, which admits "". `email` was already safe, being
 *   `applicationEmail` — `.email()` refuses the empty string.
 *
 *   The submit door writes those blanks straight onto the learner's own user
 *   row, so this is not only a lax form: it is how a user record comes to have
 *   no surname and no state.
 *
 *   ── WHY IT WAS DEFERRED, AND WHAT MADE IT SAFE ──────────────────────────
 *
 *   one-door-parsed-and-the-other-did-not recorded the blocker: "Tightening it
 *   would refuse resubmission of historical rows that the edit form loads back
 *   into itself, and how many of those carry a blank is not measurable from
 *   here."
 *
 *   The refusal was never the problem — an applicant SHOULD be made to fill a
 *   field the form calls required. The problem was that both doors report
 *   `issues[0]?.message`, and a bare `.min(1)` says "String must contain at
 *   least 1 character(s)": a refusal naming no field, on a form somebody cannot
 *   then fix. THAT is what would have stranded them.
 *
 *   So every message names its own field, and the doors now report all of them
 *   at once rather than one per round trip. A historical row with three blanks
 *   gets one sentence listing three fields instead of three refusals.
 */
const requiredField = (label: string) => z.string().trim().min(1, `${label} is required.`);

export const AcademyApplicationInputSchema = z.object({
    personalInfo: z.object({
        firstName: requiredField("First name"),
        lastName: requiredField("Last name"),
        //   NOT required, and the form agrees — it is the one field in that step
        //   without the attribute. #452: "A middle name is ordinary in Nigeria",
        //   and so is not having one.
        otherName: z.string().optional(),
        fullName: z.string().optional(),
        //   #912 Normalised here, so the resubmit door writes the same form the
        //   submit door writes and the duplicate guard can find either. See the
        //   note on applicationEmail for what the two doors used to disagree
        //   about and which reader actually noticed.
        email: applicationEmail,
        phone: requiredField("Phone number"),
        dateOfBirth: requiredField("Date of birth"),
        gender: requiredField("Gender"),
        state: requiredField("State of residence"),
        lga: requiredField("Local government area"),
        occupation: requiredField("Current occupation"),
    }),
    education: z.object({
        educationLevel: z.string(),
        fieldOfStudy: z.string(),
        yearsExperience: z.number(),
        currentRole: z.string(),
    }),
    interests: z.object({
        learningPaths: z.array(z.string()),
        topics: z.string(),
        goals: z.string(),
    }),
});

export type AcademyApplicationInput = z.infer<typeof AcademyApplicationInputSchema>;

