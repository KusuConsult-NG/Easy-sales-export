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

export const bankAccountSchema = z.object({
    accountNumber: z.string().min(10).max(10),
    bankCode: z.string().min(3),
    accountName: z.string().optional(),
});
