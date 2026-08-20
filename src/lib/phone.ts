/**
 * normalisePhone — Converts any Nigerian phone format to E.164 (+234XXXXXXXXXX)
 *
 * Handles:
 *   08012345678  → +2348012345678
 *   2348012345678 → +2348012345678
 *   +2348012345678 → +2348012345678 (no-op)
 *
 * Returns null for strings that cannot be normalised to a 13-digit +234 number.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let p = String(raw).replace(/\D/g, '');
    if (p.startsWith('0')) p = '234' + p.slice(1);
    if (p.startsWith('234') && p.length >= 13) return '+' + p;
    if (p.length >= 10) return '+234' + p.slice(-10);
    return null;
}

/**
 * normalisePhoneLoose — Same as normalisePhone but accepts shorter numbers.
 * Use only for display purposes, not for dedup queries.
 */
export function normalisePhoneLoose(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let p = String(raw).replace(/\D/g, '');
    if (p.startsWith('0')) p = '234' + p.slice(1);
    if (p.length < 10) return null;
    return '+' + p;
}

/**
 * Every spelling of one number that might be STORED against a user.
 *
 * WHY A LOOKUP NEEDS MORE THAN THE NORMALISED FORM
 * ------------------------------------------------
 * registerAction normalises before it writes, so an account created through
 * registration carries `+234…`. Several OTHER writers put the raw value on the
 * same field:
 *
 *   admin/_legacy.ts        `phone: data.phone`   — the bulk member import
 *   admin/_marketplace.ts   `phone: verificationData.phoneNumber || …`
 *   export/_ex_onboarding   `phone: validatedData.profile.phone`
 *   kyc.ts                  `phone: payload.phoneNumber`
 *
 * So the users collection holds BOTH spellings, and a duplicate check that asks
 * only for `+234…` cannot see a member whose number was written by any of those
 * paths. That check is the one thing standing between the platform and two
 * accounts on one phone number, and the bulk import is where most members came
 * from — so the guard was blind to most of the platform.
 *
 * Returns the distinct spellings to look for, most likely first. An `in` query
 * over three values costs the same as one and needs no backfill, which matters:
 * a backfill of a live users collection is a separate, riskier change.
 *
 * NOT a display helper. This exists to be handed to a `where(field, "in", …)`.
 */
export function phoneLookupVariants(raw: string | null | undefined): string[] {
    const normalised = normalisePhone(raw);
    if (!normalised) {
        const trimmed = String(raw ?? "").trim();
        return trimmed ? [trimmed] : [];
    }

    // +2348031234567 -> 8031234567
    const national = normalised.slice(4);

    const variants = [
        normalised,             // +2348031234567
        `0${national}`,         // 08031234567
        `234${national}`,       // 2348031234567
        String(raw ?? "").trim(),
    ];

    return [...new Set(variants.filter(Boolean))];
}
