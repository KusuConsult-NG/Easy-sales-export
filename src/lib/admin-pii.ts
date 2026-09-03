/**
 * What an admin who cannot act on a record may not read from it.
 *
 * Twelve admin list actions were found returning somebody's bank account
 * number, account name, bank code — and in four of them their BVN, NIN and next
 * of kin — behind a gate looser than the one on the action the screen exists to
 * perform. The gates are now per-module (see the sweep test), but several of
 * those lists also spread a raw user or registration document into the
 * response, where the same values sit nested and survive any field-by-field
 * gate applied above them.
 *
 * This is the strip for those spreads.
 */

/** Keys that identify a person's money or identity, at any nesting depth. */
export const PII_KEYS: readonly string[] = [
    "bankDetails",
    "bankAccount",
    "bankAccountNumber",
    "bankAccountName",
    "accountNumber",
    "accountName",
    "bankCode",
    "bvn",
    "nin",
    "nextOfKin",
    "verificationProfile",
    // Scanned identity papers — ID card, business certificate, proof of
    // address. #148 closed the same exposure on the land verification queue,
    // where the "documents" were the deeds to a parcel.
    "documents",
];

/**
 * Keys that are somebody's CREDENTIAL, not their information.
 *
 *   #341 A SPREAD OF THE RAW USER DOCUMENT CARRIES THE SECOND FACTOR.
 *
 *        The academy application list built its row as
 *
 *            const mergedData = { ...uData, ...app, ... };
 *            ...
 *            data: mergedData,
 *
 *        where `uData` is the whole USERS document. `...app` overrides the keys
 *        the two share; every key only the user document has survives — and the
 *        user document holds `totpSecret` and `mfaRecoveryCodes`.
 *
 *        These are categorically different from the keys above. A BVN is
 *        information about a person that an admin approving their application
 *        has a reason to see; a TOTP secret is the thing that PROVES they are
 *        that person. No admin permission is a reason to hold it, so this list
 *        is stripped unconditionally rather than gated — that is what
 *        stripSecrets is for, and stripPii removes them too.
 *
 *        `password` and `passwordHash` are named here although nothing in this
 *        codebase writes either: authentication is Supabase Auth's, and the
 *        user row has never held a credential of that kind. They are on the
 *        list because a denylist that names only what exists today is how
 *        `documents` came to be missing from INTERNAL_LAND_FIELDS (#340) — the
 *        cost of naming them is nothing, and the cost of not naming them is a
 *        password hash in an admin JSON response.
 */
export const SECRET_KEYS: readonly string[] = [
    "totpSecret",
    "mfaRecoveryCodes",
    "password",
    "passwordHash",
];

const SECRETS = new Set(SECRET_KEYS);

const PII = new Set([...PII_KEYS, ...SECRET_KEYS]);

/**
 * A copy of `value` with every PII key removed, however deeply nested.
 *
 * Non-plain values (dates, arrays of scalars, primitives) pass through
 * unchanged; arrays are mapped so a list of registration objects is stripped
 * element by element.
 */
export function stripPii<T>(value: T): T {
    if (Array.isArray(value)) return value.map((v) => stripPii(v)) as unknown as T;
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return value;

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (PII.has(key)) continue;
        out[key] = stripPii(v);
    }
    return out as unknown as T;
}

/**
 * A copy of `value` with every CREDENTIAL key removed, however deeply nested,
 * and nothing else touched.
 *
 * For the branch where the caller MAY see the record — the admin who approves
 * the application, the finance role who processes the withdrawal. They see what
 * they are deciding on; they do not see the second factor.
 */
export function stripSecrets<T>(value: T): T {
    if (Array.isArray(value)) return value.map((v) => stripSecrets(v)) as unknown as T;
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return value;

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (SECRETS.has(key)) continue;
        out[key] = stripSecrets(v);
    }
    return out as unknown as T;
}

/**
 * The serviceRegistrations map with each module's PII removed and its status
 * left alone — the admin user table derives module badges from `reg.status`,
 * and that is not sensitive.
 */
export function stripRegistrationPii(
    registrations: unknown,
): Record<string, unknown> {
    if (!registrations || typeof registrations !== "object") return {};
    return stripPii(registrations as Record<string, unknown>);
}

/**
 * Credential words that belong in a DEBUGGING TRACE's redaction set but not in
 * the admin-response strips above.
 *
 * `token` and `secret` are generic enough to name something innocuous in an
 * admin payload, so widening SECRET_KEYS with them would change eight live
 * call sites for no security gain. A trace is different: over-redacting a
 * debugging artefact costs nothing, and under-redacting one writes a
 * credential to a database row.
 */
export const TRACE_ONLY_SECRET_KEYS: readonly string[] = [
    "confirmpassword",
    "currentpassword",
    "newpassword",
    "pin",
    "cvv",
    "token",
    "secret",
    "authcode",
    "otp",
    "mfatoken",
    "recoverycode",
    "apikey",
    "accesstoken",
    "refreshtoken",
];

/** Everything redactPii hides, lower-cased once so matching is case-blind. */
const TRACE_REDACT = new Set(
    [...PII_KEYS, ...SECRET_KEYS, ...TRACE_ONLY_SECRET_KEYS].map((k) => k.toLowerCase()),
);

/**
 * A copy of `value` with every sensitive key's VALUE replaced by "[REDACTED]",
 * at any depth, case-insensitively.
 *
 *   #360 THIS EXISTS BECAUSE safe-action.ts HAD ITS OWN HAND-WRITTEN COPY, AND
 *        IT RAN ON THE ARGUMENTS OF EVERY SERVER ACTION IN THE APPLICATION.
 *
 *        See the write-up in lib/safe-action.ts. In short: that list named
 *        seven fields, two of which could never match because it stored them
 *        camelCase and compared them lower-cased, and it named none of the PII
 *        this file has defined since #151 — no bvn, no nin, no accountNumber,
 *        no totpSecret.
 *
 *        REDACTED, NOT REMOVED. A trace exists to show which arguments an
 *        action was called with; deleting the key hides that the argument was
 *        passed at all, which is the thing a debugger needs to know.
 */
export function redactPii<T>(value: T): T {
    if (Array.isArray(value)) return value.map((v) => redactPii(v)) as unknown as T;
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return value;

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        out[key] = TRACE_REDACT.has(key.toLowerCase()) ? "[REDACTED]" : redactPii(v);
    }
    return out as unknown as T;
}
