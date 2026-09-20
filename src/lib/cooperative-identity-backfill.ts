/**
 * Filling in a membership row from what the platform already knows.
 *
 *   715 MEMBERS WERE ACTIVE AND PAID WITH NO NAME, NO PHONE, NO DATE OF
 *   BIRTH, NO OCCUPATION, NO LGA, NO WARD AND NO ADDRESS.
 *
 *   THE OWNER: "missing details for this user and others".
 *
 *   Measured on production, of those 715:
 *
 *       with a savings balance          1
 *       with a loan balance             0
 *       approved by an admin          328
 *       carrying even an EMAIL         48
 *
 *   667 of them do not have an email address on the membership row. Whatever
 *   is known about these people is not on that row; it is on the USER
 *   document, or in a module registration hanging off it.
 *
 * ── WHY THERE IS ANYTHING TO RECOVER AT ALL ─────────────────────────────────
 *
 *   The payment path creates the membership row with the fee and nothing
 *   else (see cooperative-member-lookup). The person, meanwhile, has usually
 *   registered for something: WAVE, the academy, the marketplace, export.
 *   #754 found the same thing from the other side — "when admin views members
 *   most times they see empty fields and missing informations" — and its fix
 *   taught extractCanonicalUser to walk `serviceRegistrations.<module>.profile`
 *   and `verificationProfile`. That resolver is the harvest here; this file
 *   decides what may be WRITTEN from it.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 *   IT DOES NOT SET onboardingCompleted, AND THAT IS THE POINT.
 *
 *   Copying a name off a WAVE registration is not the member filling in the
 *   cooperative's form. Setting the flag would launder derived data as a
 *   declaration — and worse, it is the exact precondition three heal sites
 *   read (module-access-check's Layer 2.6, _coop_membership, and the ID-card
 *   heal 045's sibling commit closed). A backfill that set it would silently
 *   grant every one of these 715 the thing those guards were just written to
 *   withhold.
 *
 *   IT NEVER OVERWRITES. Only a field the row does not have is written, so a
 *   member whose record is already correct cannot be changed by this, and
 *   running it twice does nothing the second time.
 *
 *   IT DOES NOT SPLIT A NAME. The harvest yields one string; guessing which
 *   part is a surname is how "Ngozi Eledumare" becomes firstName "Ngozi",
 *   lastName "Eledumare" and a member called Ngozi Chinedu Eledumare loses a
 *   name. `fullName` is written, which is what the admin screen and the
 *   member directory already read when firstName is absent (#825).
 *
 *   EVERY WRITTEN FIELD IS RECORDED. `_identityBackfilledFields` names them,
 *   so an admin can always tell a value the member declared from one the
 *   platform inferred on their behalf.
 */

import { extractCanonicalUser } from "@/lib/canonical/normalizer";

/** Present means a real value, not an empty string or a blank object. */
function present(v: unknown): boolean {
    if (v === null || v === undefined || v === false) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
}

/**
 * The first real value for `pick` across the user's module registrations.
 *
 * The same `reg.profile || reg` shape extractCanonicalUser and _users.ts both
 * use — some generations nest the profile under the registration and some do
 * not. Here for the two fields the canonical resolver does not return.
 */
function fromModules(uData: any, pick: (p: any) => unknown): unknown {
    const profiles: any[] = Object.values(uData?.serviceRegistrations ?? {})
        .map((reg: any) => reg?.profile || reg)
        .filter((p: any) => p && typeof p === "object");
    for (const p of profiles) {
        const v = pick(p);
        if (present(v)) return v;
    }
    return undefined;
}

/** What a backfill would write onto one membership row, and from where. */
export interface IdentityPatch {
    /** Only the fields that are absent on the row and known elsewhere. */
    fields: Record<string, unknown>;
    /** Their names, for the audit trail and the report. */
    filled: string[];
}

/**
 * The fields this would add to `member`, given the member's user document.
 *
 * Returns an empty patch when there is nothing to add — which is the common
 * case for a member who completed onboarding, and the answer for one the
 * platform genuinely knows nothing about.
 */
export function identityPatchFor(
    member: Record<string, any> | null | undefined,
    uData: Record<string, any> | null | undefined,
): IdentityPatch {
    const m = member ?? {};
    //   The member row is passed as `appData` as well, which is how
    //   extractCanonicalUser is called everywhere else: it lets the row's own
    //   values win over the user document's, so the harvest can never be
    //   WORSE than what is already there.
    const canonical = extractCanonicalUser(uData ?? {}, m);

    const candidates: Record<string, unknown> = {
        //   A single string. See the header on why it is not split.
        fullName:           canonical.name,
        phone:              canonical.phone,
        email:              canonical.email,
        dateOfBirth:        canonical.dateOfBirth,
        gender:             canonical.gender,
        stateOfOrigin:      canonical.address?.state,
        lga:                canonical.address?.lga,
        residentialAddress: canonical.address?.street,
        //   Not on extractCanonicalUser's return, and adding them there would
        //   change six screens for a repair that needs them twice.
        occupation: present(uData?.occupation)
            ? uData?.occupation
            : fromModules(uData, (p) => p.occupation),
        ward: present(uData?.ward)
            ? uData?.ward
            : fromModules(uData, (p) => p.address?.ward || p.ward),
    };

    const fields: Record<string, unknown> = {};
    const filled: string[] = [];

    for (const [key, value] of Object.entries(candidates)) {
        //   ABSENT ON THE ROW, and known. Never an overwrite.
        if (present(m[key])) continue;
        if (!present(value)) continue;
        fields[key] = typeof value === "string" ? value.trim() : value;
        filled.push(key);
    }

    //   A name is the field this exists for. Recorded so the caller can report
    //   "recovered a name for N of 715" rather than only a field count.
    return { fields, filled };
}

/** Whether a membership row names somebody. The measure of the 715. */
export function rowNamesSomebody(member: Record<string, any> | null | undefined): boolean {
    const m = member ?? {};
    return present(m.fullName) || present(m.firstName) || present(m.lastName);
}
