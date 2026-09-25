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

/**
 * The one form an application's email address is stored in.
 *
 *   #912 TWO DOORS WROTE THE SAME FIELD AND ONLY ONE NORMALISED IT.
 *
 *   _submitAcademyApplicationAction lowercases and trims the address before it
 *   writes, and says why at the line:
 *
 *       // Overwrites the typed casing from the spread above. The three
 *       // recovery lookups all query the lowercased form, and one of them
 *       // grants academy module access.
 *
 *   _resubmitAcademyApplicationAction writes the same field from
 *   AcademyApplicationInputSchema's output, which was `z.string().email()` —
 *   the address exactly as typed. And it writes it with
 *   `transaction.update(ref, { ...validatedData })`, where a nested map REPLACES
 *   rather than merges (supabase-db's own note: `update({ a: { b: 1 } })`
 *   REPLACES a). So one resubmission with a capital letter in the address
 *   replaced the normalised value with the typed one.
 *
 * ── WHAT THAT ACTUALLY COSTS, MEASURED RATHER THAN ASSUMED ──────────────────
 *
 *   The comment names three readers and the worst-sounding consequence is NOT
 *   live. module-access-check's Layer 2.7, _ac_enrollment and _payment all reach
 *   the typed-address query only as a FALLBACK, when the owner-scoped
 *   (`userId`) query comes back empty — and a resubmitted application was found
 *   BY `userId`, so it always has one. Those three take the owner path for this
 *   learner and never consult the address.
 *
 *   The live one is the DUPLICATE GUARD in the submit transaction:
 *
 *       collectionsContext.where("personalInfo.email", "==", normalisedEmail)
 *
 *   A row de-normalised by a resubmission is invisible to it, so the "one
 *   application per address" rule can be passed by an address that already has
 *   one. That is the shape of the split accounts already sitting on
 *   /admin/forensics/duplicates, and the phone guard three lines above it
 *   already knows the lesson — it queries BOTH `phone` and `normalisePhone(phone)`
 *   because stored values come in more than one form. The email guard queries
 *   one form and trusts every writer to have produced it.
 *
 *   So: normalise at the parse boundary, where every caller of the schema gets
 *   it, and have the submit door use the same function rather than its own two
 *   lines. A rule stated once cannot disagree with itself.
 */
export const normaliseEmail = (email: unknown): string =>
    typeof email === 'string' ? email.trim().toLowerCase() : '';

/**
 * A validated, normalised email address for an application row.
 *
 * Validate first, then normalise: `.email()` rejects a non-address, and the
 * transform only ever runs on something that passed. The other order would
 * lowercase garbage and then reject it, which reports the same error about a
 * value the user did not type.
 */
export const applicationEmail = z.string().trim().email().transform(normaliseEmail);

/**
 *   NOT FIXED HERE, and worth knowing about: two more copies of those two lines
 *   exist — lib/profile-lookup.ts exports its own `normaliseEmail` and
 *   lib/cooperative-invite.ts declares a private one. All three agree today
 *   (trim then lowercase), so nothing is broken by the duplication yet.
 *
 *   profile-lookup's copy is not imported from here because that module pulls in
 *   supabase-db, and a validation schema should not drag the database in behind
 *   it. Folding those two into this one is a separate change on the auth path,
 *   not something to bundle into an academy fix.
 */
