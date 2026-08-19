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

const PII = new Set(PII_KEYS);

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
