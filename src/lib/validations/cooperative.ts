import { z } from "zod";
import { dateSchema, addressSchema, bankDetailsSchema } from "./shared";

/**
 * Cooperative Membership & Onboarding Schemas
 * Used to ensure strict data integrity and heal fragmented legacy records.
 */

export const CooperativeOnboardingSchema = z.object({
    id: z.string(),
    userId: z.string(),
    userEmail: z.string().optional(),
    tier: z.enum(["tier1", "tier2"]).default("tier1"),
    personalInfo: z.object({
        firstName: z.string().default(""),
        lastName: z.string().default(""),
        dateOfBirth: z.string().default(""),
        gender: z.string().default(""),
        occupation: z.string().default(""),
        address: z.string().default(""),
        phone: z.string().optional(),
        state: z.string().default(""),
        lga: z.string().default(""),
    }).default({
        firstName: "",
        lastName: "",
        dateOfBirth: "",
        gender: "",
        occupation: "",
        address: "",
        state: "",
        lga: "",
    }),
    nextOfKin: z.object({
        name: z.string().default(""),
        relationship: z.string().default(""),
        phone: z.string().default(""),
    }).default({
        name: "",
        relationship: "",
        phone: "",
    }),
    documents: z.object({
        validId: z.object({ name: z.string(), url: z.string() }).optional(),
        idType: z.string().optional(),
        idNumber: z.string().optional(),
        passportPhoto: z.object({ name: z.string(), url: z.string() }).optional(),
        proofOfAddress: z.object({ name: z.string(), url: z.string() }).optional(),
        bvn: z.string().optional(),
    }).default({}),
    paymentReference: z.string().optional(),
    paymentStatus: z.enum(["pending", "completed", "failed"]).default("pending"),
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    submittedAt: dateSchema.optional(),
    reviewedAt: dateSchema.optional(),
    reviewedBy: z.string().optional(),
    rejectionReason: z.string().optional(),
    createdAt: dateSchema,
    updatedAt: dateSchema.optional(),
    _version: z.number().default(1),
});

export type CooperativeOnboarding = z.infer<typeof CooperativeOnboardingSchema>;

/**
 * Cooperative Member Schema (The finalized record)
 */
export const CooperativeMemberSchema = z.object({
    id: z.string(), // Usually the same as userId
    userId: z.string(),
    userEmail: z.string().optional(),
    fullName: z.string().default(""),
    tier: z.enum(["tier1", "tier2"]).default("tier1"),
    status: z.enum(["active", "suspended", "inactive"]).default("active"),
    membershipId: z.string().optional(),
    joinedAt: dateSchema,
    createdAt: dateSchema,
    updatedAt: dateSchema.optional(),
    _version: z.number().default(1),
});

export type CooperativeMember = z.infer<typeof CooperativeMemberSchema>;
