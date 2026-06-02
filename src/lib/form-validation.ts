/**
 * form-validation.ts
 *
 * DISEASE 6 FIX — Zod schema ↔ form field name mismatch.
 *
 * Problem: Server actions read FormData with formData.get("fieldName") and
 * then pass the raw strings to a Zod schema. There is no compile-time binding
 * between the HTML <input name="..."> attribute and the schema field name.
 * When either side is renamed, the mismatch causes invisible validation errors.
 *
 * This module provides:
 *   1. `parseFormData<T>(schema, formData)` — validates a FormData object
 *      against a Zod schema. Returns typed data or throws a structured error.
 *      Use in ALL server actions instead of manual formData.get() + safeParse().
 *
 *   2. `formDataToObject(formData)` — converts FormData to a plain object
 *      (handles multiple values for the same key as arrays).
 *
 *   3. `FormActionResult<T>` — standard typed return type for form actions.
 *
 * Usage in a server action:
 *
 *   import { parseFormData } from "@/lib/form-validation";
 *   import { cooperativeMembershipSchema } from "@/lib/types/cooperative";
 *
 *   async function myAction(formData: FormData) {
 *     const result = parseFormData(cooperativeMembershipSchema, formData);
 *     if (!result.success) return { success: false, error: result.error, fieldErrors: result.fieldErrors };
 *     const { firstName, stateOfOrigin } = result.data; // ← fully typed
 *   }
 *
 * Usage in a React form component (for zodResolver binding):
 *
 *   import { zodResolver } from "@hookform/resolvers/zod";
 *   import { useForm } from "react-hook-form";
 *   import { cooperativeMembershipSchema, type CooperativeMembershipFormData }
 *     from "@/lib/types/cooperative";
 *
 *   const form = useForm<CooperativeMembershipFormData>({
 *     resolver: zodResolver(cooperativeMembershipSchema),
 *   });
 *   // Now form.register("stateOfOrigin") is TypeScript-checked against the schema.
 *   // If someone renames it to "state", TypeScript will error at compile time.
 */

import { z, ZodSchema, ZodError } from "zod";

// ── Types ──────────────────────────────────────────────────────────────────────

export type FormActionSuccess<T> = {
    success: true;
    data: T;
    error: null;
    fieldErrors: null;
};

export type FormActionError = {
    success: false;
    data: null;
    error: string;
    fieldErrors: Record<string, string[]> | null;
};

export type FormActionResult<T> = FormActionSuccess<T> | FormActionError;

// ── Core utility ───────────────────────────────────────────────────────────────

/**
 * Converts a FormData instance to a plain object.
 * - Multiple values for the same key are collected into an array.
 * - File entries are preserved as-is.
 * - Empty strings are preserved (caller can .optional() in schema).
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of formData.entries()) {
        if (Object.prototype.hasOwnProperty.call(result, key)) {
            // Already exists — convert to array or push
            const existing = result[key];
            if (Array.isArray(existing)) {
                existing.push(value);
            } else {
                result[key] = [existing, value];
            }
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Validates a FormData object against a Zod schema.
 *
 * Returns a discriminated union result:
 * - `{ success: true, data: T }` when valid
 * - `{ success: false, error: string, fieldErrors: Record<string, string[]> }` when invalid
 *
 * This is the SINGLE binding point between form fields and schema validation.
 * When a field name drifts, Zod will report the issue through fieldErrors rather
 * than silently producing an undefined value.
 */
export function parseFormData<T>(
    schema: ZodSchema<T>,
    formData: FormData
): FormActionResult<T> {
    const raw = formDataToObject(formData);
    const result = schema.safeParse(raw);

    if (result.success) {
        return {
            success: true,
            data: result.data,
            error: null,
            fieldErrors: null,
        };
    }

    const fieldErrors = formatZodErrors(result.error);
    const firstError = getFirstErrorMessage(result.error);

    return {
        success: false,
        data: null,
        error: firstError,
        fieldErrors,
    };
}

/**
 * Same as parseFormData but throws a structured Error on failure.
 * Use when you want to bubble validation errors up to a try/catch block.
 */
export function parseFormDataOrThrow<T>(schema: ZodSchema<T>, formData: FormData): T {
    const result = parseFormData(schema, formData);
    if (!result.success) {
        const err = new Error(result.error ?? "Validation failed") as Error & {
            fieldErrors: Record<string, string[]> | null;
        };
        err.fieldErrors = result.fieldErrors;
        throw err;
    }
    return result.data;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Formats a ZodError into a flat { fieldName: string[] } map.
 * Nested fields are flattened to dot notation (e.g., "personalInfo.firstName").
 */
export function formatZodErrors(error: ZodError): Record<string, string[]> {
    const errors: Record<string, string[]> = {};

    for (const issue of error.issues) {
        const path = issue.path.join(".");
        const key = path || "_root";
        if (!errors[key]) errors[key] = [];
        errors[key].push(issue.message);
    }

    return errors;
}

/**
 * Returns the first human-readable error message from a ZodError.
 */
export function getFirstErrorMessage(error: ZodError): string {
    const first = error.issues[0];
    if (!first) return "Validation failed";
    const path = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    return `${path}${first.message}`;
}

/**
 * Type guard: checks whether a value is a successful FormActionResult.
 */
export function isFormSuccess<T>(result: FormActionResult<T>): result is FormActionSuccess<T> {
    return result.success === true;
}
