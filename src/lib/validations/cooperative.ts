import { z } from "zod";
import { dateSchema, addressSchema, bankDetailsSchema } from "./shared";

/**
 * @deprecated ORPHANED SCHEMA — DO NOT USE IN SERVER ACTIONS.
 *
 * DISEASE 6 NOTE: This file contains `CooperativeOnboardingSchema` which uses
 * NESTED field names (personalInfo.state, personalInfo.lga, nextOfKin.name).
 *
 * The LIVE schema used by server actions is `cooperativeMembershipSchema` in:
 *   src/lib/types/cooperative.ts
 *
 * That schema uses FLAT field names (stateOfOrigin, lga, nextOfKinName) which
 * match the actual HTML form fields. Using CooperativeOnboardingSchema in a
 * server action would cause silent validation failures because formData.get("state")
 * would not populate personalInfo.state.
 *
 * This file is kept for legacy Firestore document validation only (data scrubbing).
 * If you need to validate form input, import from src/lib/types/cooperative.ts.
 *
 *   #369 MEASURED: NOTHING IMPORTS THIS FILE — not for data scrubbing, not for
 *        anything. The note above says what it is "kept for"; the reachability
 *        walk says nothing does that with it. It is one of three orphaned
 *        schema modules, alongside validations/escrow.ts and types/db-schemas.ts,
 *        both of which contradicted the live rule they duplicate. This one does
 *        not contradict anything — its nested shape is documented as
 *        deliberately different — so it is left exactly as it is, with the
 *        reachability fact added so "kept for X" is not read as "used for X".
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
