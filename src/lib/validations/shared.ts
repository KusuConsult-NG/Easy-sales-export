import { z } from "zod";

/**
 * Shared Zod Schemas & Helpers
 * Used across multiple modules to ensure consistent data healing.
 */

export const dateSchema = z.preprocess((arg) => {
    if (arg instanceof Date) return arg;
    if (typeof arg === 'object' && arg !== null) {
        const v = arg as any;
        if (typeof v.toDate === 'function') return v.toDate();
        if ('seconds' in v) return new Date(v.seconds * 1000);
    }
    if (typeof arg === 'string') return new Date(arg);
    return new Date(); // Default to now if missing/invalid
}, z.date());

export const addressSchema = z.object({
    street: z.string().default(""),
    city: z.string().default(""),
    state: z.string().default(""),
    lga: z.string().default(""),
    country: z.string().default("Nigeria"),
}).default({
    street: "",
    city: "",
    state: "",
    lga: "",
    country: "Nigeria",
});

export const bankDetailsSchema = z.object({
    accountNumber: z.string().default(""),
    bankName: z.string().default(""),
    accountName: z.string().default(""),
    bankCode: z.string().default(""),
}).default({
    accountNumber: "",
    bankName: "",
    accountName: "",
    bankCode: "",
});

/**
 * A Nigerian NUBAN account number: exactly ten digits.
 *
 *   #524. The rule is written three times in this codebase and they do not
 *   agree — schemas.ts and validations/marketplace both require DIGITS, while
 *   bankAccountSchema below asks only `min(10).max(10)`, which accepts
 *   "abcdefghij". That one is imported for its TYPE only (paystack-transfer
 *   never parses with it), so nothing live is looser than it looks — measured
 *   before it was left alone.
 *
 *   This exists because the admin application editor wrote an account number
 *   with no check at all, and a fourth hand-written /^\d{10}$/ is how a fourth
 *   disagreement starts.
 */
export const nubanAccountNumber = z.string().trim().regex(/^\d{10}$/, "Account number must be 10 digits");

export const bankAccountSchema = z.object({
    accountNumber: z.string().min(10).max(10),
    bankCode: z.string().min(3),
    accountName: z.string().optional(),
});
