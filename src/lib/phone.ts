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

/**
 * Is this a Nigerian MOBILE number?
 *
 *   #919 TWO FUNCTIONS OF THIS NAME EXISTED AND DISAGREED.
 *
 *       components/ui/PhoneInput   /^0[789][01]\d{8}$/   and two siblings
 *       lib/security               /^(\+?234|0)[789]\d{9}$/
 *
 *   The middle digit is the whole difference, and it is not cosmetic. Nigerian
 *   mobile prefixes are 070, 071, 080, 081, 090 and 091 — so `[789][01]` is the
 *   real set and `[789]\d` wrongly admits 072…079, 082…089 and 092…099.
 *   MEASURED: they disagree on 08212345678, 07512345678, 09512345678 and
 *   +2348512345678, among others.
 *
 *   WHICH ONE WAS LIVE, measured before assuming: PhoneInput's. The only
 *   importer of the name is marketplace/checkout, and it imports it from
 *   PhoneInput. lib/security's copy has NO callers at all — so this was never a
 *   live defect, it was a dead and WRONG copy of a live rule, in the module whose
 *   name is the first place somebody would look for it.
 *
 *   That is the trap validations/shared's nubanAccountNumber header already
 *   describes about account numbers: "a fourth hand-written /^\d{10}$/ is how a
 *   fourth disagreement starts." Here it had already started.
 *
 *   So the rule lives here, once, and both spellings delegate to it. Nothing is
 *   deleted: lib/security keeps its export and its name, and now cannot answer
 *   differently from the field a person actually types into.
 *
 * ── WHAT IT ACCEPTS, AND WHY THAT IS THE LIVE SET ───────────────────────────
 *
 *   The three shapes PhoneInput accepted, because that is what the checkout
 *   accepts today and narrowing it would refuse numbers the platform currently
 *   takes:
 *
 *       0XXXXXXXXXX     eleven digits, local form
 *       234XXXXXXXXXX   thirteen, with or without a leading +
 *       XXXXXXXXXX      ten, the national number on its own
 *
 *   Separators are stripped first, so "+234 801 234 5678" is the same number as
 *   "08012345678" — which is how people write it and what normalisePhone above
 *   already assumes.
 */
export function isNigerianMobile(phone: string | null | undefined): boolean {
    if (!phone) return false;

    const cleaned = String(phone).replace(/\D/g, '');

    if (cleaned.length === 11 && cleaned.startsWith('0')) return /^0[789][01]\d{8}$/.test(cleaned);
    if (cleaned.length === 13 && cleaned.startsWith('234')) return /^234[789][01]\d{8}$/.test(cleaned);
    if (cleaned.length === 10) return /^[789][01]\d{8}$/.test(cleaned);

    return false;
}
