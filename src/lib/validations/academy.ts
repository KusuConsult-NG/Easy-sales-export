import { z } from "zod";
import { dateSchema } from "./shared";

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
    plan: z.enum(["standard", "premium", "elite"]).default("standard"),
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

export const AcademyApplicationInputSchema = z.object({
    personalInfo: z.object({
        firstName: z.string(),
        lastName: z.string(),
        otherName: z.string().optional(),
        fullName: z.string().optional(),
        email: z.string().email(),
        phone: z.string(),
        dateOfBirth: z.string(),
        gender: z.string(),
        state: z.string(),
        lga: z.string(),
        occupation: z.string(),
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

