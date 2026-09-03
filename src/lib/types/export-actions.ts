/**
 * Export module types, action states and input schemas.
 *
 * All of these were declared at the top of actions/export.ts and used across
 * it, so splitting that 1,534-line file by domain would have left them in
 * whichever piece kept them.
 *
 * The two zod schemas come along because ExportWindowFormData is
 * `z.infer<typeof exportWindowSchema>` — the type cannot leave the schema
 * behind. They are validation inputs rather than server actions, so a plain
 * module is where they belong anyway.
 *
 * packages/export/src/types.ts declares ExportWindow, which is the record as a
 * caller receives it. Nothing here redeclares that name; these are the action
 * layer's own input and result shapes. The name collisions found in #205, #206
 * and #207 do not apply to this one.
 *
 * A plain module, not one under src/app/actions, where every file must carry
 * "use server" and a session guard.
 */

import { z } from "zod";
import type { ExportWindow } from "@/lib/types/firestore";

export type ExportWindowFormData = z.infer<typeof exportWindowSchema>;


type ActionErrorState = { error: string;
    success: false;
    data?: null;
    meta?: null; };




type CreateExportSuccessState = { error: null;
    success: true;
    message: string;
    data: { orderId: string };
    meta: null;
};


type UpdateStatusSuccessState = { error: null;
    success: true;
    message: string; data: null;
    meta: null; };


type GetExportsSuccessState = { error: null;
    success: true;
    data: ExportWindow[];
    meta: { cursor: string | null; hasMore: boolean } | null;
};


export type CreateExportActionState = ActionErrorState | CreateExportSuccessState;

export type UpdateStatusActionState = ActionErrorState | UpdateStatusSuccessState;

export type UpdateExportStatusState = UpdateStatusActionState;
 // Alias for compatibility
export type GetExportsActionState = ActionErrorState | GetExportsSuccessState;



/**
 * Server Actions for Export Window Management
 * 
 * Handles CRUD operations for export windows including creation,
 * status updates, and listing with filters.
 */

// Export Window Schema
// Kept as a private const — NOT exported ("use server" files cannot export non-async values)
export const exportWindowSchema = z.object({ commodity: z.enum(["yam", "sesame", "hibiscus", "other"], {
        message: "Please select a valid commodity" }),
    quantity: z.string().min(1, "Quantity is required"),
    amount: z.number().positive("Amount must be greater than 0"),
    deliveryDate: z.string().optional(),
    destination: z.enum(["europe", "north_america", "asia", "middle_east", "africa", "other"], { message: "Please select a valid destination" }).optional() });



export const exportOnboardingSchema = z.object({
    profile: z.object({
        firstName: z.string().min(2, "First name is required"),
        lastName: z.string().min(2, "Last name is required"),
        otherName: z.string().optional().nullable().or(z.literal("")),
        phone: z.string().min(10, "Phone number is required"),
        email: z.string().email().optional().or(z.literal("")),
        state: z.string().min(2, "State is required"),
        lga: z.string().min(2, "LGA is required"),
        address: z.string().min(5, "Address is required"),
    }),
    kycData: z.object({
        nin: z.string().optional().or(z.literal("")),
        bvn: z.string().optional().or(z.literal("")),
        cacNumber: z.string().optional().or(z.literal("")),
        /**
         * #349 KYCForm collects a Voter's Card number and offers to verify it.
         * Zod strips unknown keys, so the number and its verification were
         * dropped between the step and the record — collected, validated, and
         * never stored.
         */
        votersCard: z.string().optional().or(z.literal("")),
        votersCardVerified: z.boolean().optional(),
        ninVerified: z.boolean().optional(),
        bvnVerified: z.boolean().optional(),
    }),
    bank: z.object({
        accountNumber: z.string().length(10, "Account number must be 10 digits"),
        bankName: z.string().min(2, "Bank name is required"),
        // #346 The submitted name is NOT what gets recorded — _ex_onboarding
        // re-resolves the account and stores the bank's answer. It stays
        // required so an empty form is still refused before the network call.
        accountName: z.string().min(2, "Account name is required"),
        /** #346 Needed to re-resolve the account server-side. */
        bankCode: z.string().optional().or(z.literal("")),
    }),
    terms: z.object({
        termsAccepted: z.boolean(),
        privacyAccepted: z.boolean(),
    })
});
