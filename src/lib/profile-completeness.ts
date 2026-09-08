/**
 * What "your profile is complete" means, in one place.
 *
 *   #529 THE GATE ON THE WHOLE PLATFORM WAS SET BY A SAVE THAT CHECKED NOTHING,
 *        AND THE PAGE IT SENT PEOPLE TO NEVER TOLD THEM WHY THEY WERE THERE.
 *
 *   requireHubRegistration wraps the dashboard and every module layout, and
 *   admits an account only when `userData.profileComplete === true`. Registration
 *   writes `profileComplete: false`. The ONLY thing that flips it true for an
 *   ordinary member is a successful save of the profile form.
 *
 *   That save validated nothing. Every field in profileUpdateSchema is
 *   `.optional()`, and the writer did
 *
 *       const updatePayload: Record<string, any> = { ...validated,
 *           profileComplete: true };
 *
 *   unconditionally — so `updateUserProfileAction({})` from any signed-in
 *   client opened the dashboard and every module on a profile with no name, no
 *   email and no phone number. A server action is a POST endpoint; the browser
 *   form is not the only caller.
 *
 *   MEANWHILE THE RULE THE PLATFORM ACTUALLY WANTED LIVED IN THE BROWSER.
 *   handleSave refuses a blank phone number, and refuses a non-Nigerian number
 *   without a government ID. Those are the real requirements and they were
 *   stated in a click handler, where nothing server-side could apply them and
 *   nothing could tell the member which of them they had failed.
 *
 * ── NEVER DOWNGRADED, DELIBERATELY ──────────────────────────────────────────
 *
 *   An account already carrying `profileComplete: true` keeps it, whatever this
 *   function says about its fields. There are ~42,000 profiles in production and
 *   many were written by importers and backfills rather than by this form (see
 *   profile-provenance.ts); recomputing the flag downwards on their next save
 *   would lock out people who have been using the platform for months. #485's
 *   standing constraint applies — onboarding and selling must not stop — and the
 *   defect being fixed is a fresh account getting IN, not existing members
 *   staying in. The one-way rule removes the hole without touching anybody who
 *   is already through it.
 *
 * ── WHY A MODULE ────────────────────────────────────────────────────────────
 *
 *   Because there are three readers and they disagreed: hub-guard reads the
 *   boolean, the writer set it blind, and the form checked two fields in the
 *   browser. This audit's most repeated finding is a rule that reached some of
 *   its doors. The rule is here; all three ask it.
 */

/** A field the member has to supply, and what to call it on screen. */
export interface MissingProfileField {
    field: string;
    label: string;
}

/** The subset of a user record this rule reads. Deliberately loose — the row is free-form. */
export interface ProfileCompletenessInput {
    firstName?: unknown;
    lastName?: unknown;
    fullName?: unknown;
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    phoneNumber?: unknown;
    identityDocument?: unknown;
    profileComplete?: unknown;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Is this phone number outside Nigeria?
 *
 * The rule handleSave applied in the browser: a non-Nigerian member must supply
 * a government-issued ID, because the identity checks this platform can run
 * (BVN, NIN) are Nigerian. A number that is not in international form is treated
 * as local — `08030000000` is how a Nigerian member writes their own number, and
 * refusing it would be the fix breaking onboarding.
 */
export function isNonNigerianPhone(phone: string): boolean {
    const p = phone.trim();
    if (!p.startsWith("+")) return false;
    return !p.startsWith("+234");
}

/**
 * Everything still missing from this profile, in the order a person fills it.
 *
 * Empty array means complete. The names are checked as a PAIR against the
 * row's own spellings — `fullName` and `name` are aliases the normaliser
 * guarantees (see user-erasure.ts on normalizeUserUpdate), so a row that has
 * only a full name is not missing its name.
 */
export function missingProfileFields(user: ProfileCompletenessInput | null | undefined): MissingProfileField[] {
    const u = user ?? {};
    const missing: MissingProfileField[] = [];

    const first = text(u.firstName);
    const last = text(u.lastName);
    const whole = text(u.fullName) || text(u.name);
    // Two parts, however they are spelled: "Ada" alone is not a name this
    // platform can put on an ID card or a certificate.
    const hasName = (first && last) || whole.split(/\s+/).filter(Boolean).length >= 2;
    if (!hasName) missing.push({ field: "name", label: "Your first and last name" });

    if (!text(u.email)) missing.push({ field: "email", label: "Your email address" });

    const phone = text(u.phone) || text(u.phoneNumber);
    if (!phone) {
        missing.push({ field: "phone", label: "Your phone number" });
    } else if (isNonNigerianPhone(phone) && !text(u.identityDocument)) {
        missing.push({
            field: "identityDocument",
            label: "A government-issued ID (required for numbers outside Nigeria)",
        });
    }

    return missing;
}

/** True when nothing is missing. */
export function isProfileComplete(user: ProfileCompletenessInput | null | undefined): boolean {
    return missingProfileFields(user).length === 0;
}

/**
 * What `profileComplete` should be after this save — never downgraded.
 *
 * `stored` is the flag as the row holds it now; `merged` is the row as it will
 * be after the patch. See the note above on why an account that is already
 * through the gate stays through it.
 */
export function nextProfileCompleteFlag(
    stored: unknown,
    merged: ProfileCompletenessInput | null | undefined,
): boolean {
    if (stored === true) return true;
    return isProfileComplete(merged);
}
