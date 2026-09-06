import { z } from "zod";
import { normaliseGender } from "../gender";
import { dateSchema, addressSchema, bankDetailsSchema } from "./shared";

/**
 * User Zod Schemas
 * Standardizes the user document structure across all onboarding modules.
 */

export const UserSchema = z.object({
    uid: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    otherName: z.string().optional(),
    fullName: z.string().default("Easy Sales User"),
    email: z.string().email().default("user@easysales.local"),
    phone: z.string().optional(),
    //   #464 This preprocess WAS the platform's only normaliser for a stored
    //        gender, and the WAVE eligibility forensic did not use it — it
    //        compared `gender !== "female"` and reported 194 of 200 participants
    //        ineligible, including people stored as "Female", the exact spelling
    //        the WAVE application's own schema requires. Stated once in
    //        lib/gender.ts and shared, rather than a second spelling here.
    gender: z.preprocess((val) => normaliseGender(val), z.enum(["male", "female"]).optional()),
    stateOfOrigin: z.string().optional(),
    lga: z.string().optional(),
    residentialAddress: z.string().optional(),
    roles: z.array(z.string()).default(["user"]),
    isVerified: z.boolean().default(false),
    verified: z.boolean().default(false), // Legacy compatibility
    
    // Core module linkages
    cooperativeId: z.string().optional(),
    cooperativeMembershipId: z.string().optional(),
    sellerVerificationId: z.string().optional(),
    onboardingCompleted: z.boolean().default(false),
    
    // Module-specific statuses
    serviceRegistrations: z.object({
        academy: z.object({
            status: z.enum(["pending", "approved", "active", "suspended", "rejected"]).default("pending"),
            plan: z.enum(["foundation", "standard", "elite", "advanced"]).optional(),
        }).optional(),
        cooperative: z.object({
            status: z.enum(["pending", "paid", "approved", "rejected"]).default("pending"),
            tier: z.enum(["tier1", "tier2"]).optional(),
        }).optional(),
        marketplace: z.object({
            status: z.enum(["pending", "approved", "rejected", "suspended"]).default("pending"),
        }).optional(),
    }).default({}),

    address: addressSchema,
    bankDetails: bankDetailsSchema,
    
    createdAt: dateSchema,
    updatedAt: dateSchema,
    _version: z.number().default(1), // Increment version to signal healing
});

export type ValidatedUser = z.infer<typeof UserSchema>;
