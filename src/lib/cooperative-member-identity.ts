/**
 * Filling in a member's personal details from the records that hold them.
 *
 *   THE ADMIN MEMBER SCREEN SHOWED AN ACTIVE, PAID MEMBER WITH NO NAME, NO
 *   PHONE, NO DATE OF BIRTH, NO OCCUPATION, NO LGA, NO WARD AND NO ADDRESS.
 *
 *   THE OWNER: "missing details for this user and others ... Full Name — /
 *   Email alzakkatintegratedltd@gmail.com / Phone — / Member Number
 *   ESE-COOP-4827 / Date of Birth — / Gender male / Occupation — / State of
 *   Origin Kogi / LGA — / Ward — / Residential Address —".
 *
 *   The shape of what survived is the whole diagnosis. Email is the one blank
 *   field with a fallback to the USERS document, and it filled. Gender and
 *   State of Origin are the two fields the ID-card editor writes
 *   (updateMemberProfileDetailsAction, reached from the member's own ID card
 *   page), and they filled. EVERY field that could only come from the
 *   onboarding form was empty — because the row being displayed was never the
 *   row the onboarding form wrote to.
 *
 *   lib/cooperative-member-lookup.ts has the mechanism: the registration route
 *   files the profile under an auto-generated id, and the client half of the
 *   payment fulfilled onto doc(userId) instead, creating a second row holding
 *   the money and nothing else. That writer is fixed. This file is for the
 *   rows already in the database, which the fix cannot reach backwards.
 *
 *   THE DETAILS ARE NOT LOST. They are one query away, on the member's other
 *   membership row, keyed by the same `userId` — the join the screen already
 *   performs against USERS, one source further out. A screen that renders "—"
 *   over data it could have read is the failed-lookup-rendered-as-absence
 *   shape this codebase keeps finding, and it is worse here than a blank
 *   field: an admin approving members cannot tell an incomplete registration
 *   from a complete one, and the export beside it ships the blanks.
 *
 *   NOT A REPAIR. Nothing here writes. Merging for display leaves both rows
 *   exactly as they are, so a reconciliation that collapses them later has the
 *   same evidence to work from.
 */

/** The fields an onboarding form fills in and a payment fulfilment does not. */
const IDENTITY_FIELDS = [
    "firstName", "middleName", "otherName", "lastName", "fullName", "otherNames",
    "phone", "dateOfBirth", "occupation",
    "stateOfOrigin", "lga", "ward", "residentialAddress",
    "email", "gender", "registrationFee", "nextOfKin",
] as const;

function present(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
}

/**
 * How much of a person this row actually carries.
 *
 * Used to choose between several rows for one member, never to decide that a
 * row is invalid. A completed onboarding outranks any field count: it is the
 * row the member themself filled in.
 */
export function identityDetailScore(row: Record<string, any> | null | undefined): number {
    if (!row) return 0;
    const fields = IDENTITY_FIELDS.reduce((n, k) => n + (present(row[k]) ? 1 : 0), 0);
    return (row.onboardingCompleted === true ? 100 : 0) + fields;
}

/**
 * The richest of a member's other membership rows, or null when none of them
 * carries more than the row in hand.
 *
 * `own` is the row being displayed; a sibling only wins where it is strictly
 * better, so this can never replace details with fewer details.
 */
export function pickDetailRow<T extends Record<string, any>>(
    own: T,
    siblings: readonly T[],
): T | null {
    const ownScore = identityDetailScore(own);
    let best: T | null = null;
    let topScore = ownScore;
    for (const s of siblings) {
        const score = identityDetailScore(s);
        if (score > topScore) { best = s; topScore = score; }
    }
    return best;
}

/**
 * One member's details, drawn from the row in hand, then their other
 * membership row, then their user profile.
 *
 * THE ORDER IS THE POINT AND IT IS THE ORDER THAT WAS ALREADY HERE: the row in
 * hand wins every field it has. `sibling` is inserted between the row and the
 * user document rather than above either, so a member whose row is complete is
 * unaffected by any of this, and a field the screen used to show can only
 * change from blank to filled.
 *
 * Written once because both hydration loops in _coop_admin_members.ts held a
 * verbatim copy of this block, and #903 had already been fixed in one of them
 * and not the other.
 */
export function mergeMemberIdentity(
    app: Record<string, any>,
    uData: Record<string, any>,
    sibling: Record<string, any> | null,
): Record<string, any> {
    const sib = sibling ?? {};
    const addr = typeof uData.address === "object" ? uData.address : null;

    return {
        ...app,
        phone:              app.phone              || sib.phone              || uData.phone         || uData.phoneNumber || null,
        gender:             app.gender             || sib.gender             || uData.gender        || null,
        dateOfBirth:        app.dateOfBirth        || sib.dateOfBirth        || uData.dateOfBirth   || uData.dob         || null,
        occupation:         app.occupation         || sib.occupation         || uData.occupation    || null,
        stateOfOrigin:      app.stateOfOrigin      || sib.stateOfOrigin      || uData.stateOfOrigin || addr?.state       || null,
        lga:                app.lga                || sib.lga                || uData.lga           || addr?.lga         || null,
        ward:               app.ward               || sib.ward               || uData.ward          || addr?.ward        || null,
        residentialAddress: app.residentialAddress || sib.residentialAddress
            || (addr ? addr.street : uData.address) || null,
        firstName:          app.firstName          || sib.firstName          || uData.firstName     || null,
        //   middleName and otherName were on neither merge, and the detail
        //   panel joins all three to make a full name.
        middleName:         app.middleName         || sib.middleName         || uData.middleName    || null,
        otherName:          app.otherName          || sib.otherName          || uData.otherName     || null,
        lastName:           app.lastName           || sib.lastName           || uData.lastName      || null,
        fullName:           app.fullName           || sib.fullName           || uData.fullName      || null,
        email:              app.email              || sib.email              || uData.email         || uData.userEmail   || null,
        nextOfKin:          app.nextOfKin          || sib.nextOfKin          || null,
        //   The fee is written by the registration route and by nothing on the
        //   payment path, so the row holding the money reported "Fee: ₦0".
        registrationFee:    app.registrationFee    ?? sib.registrationFee    ?? null,
        //   Which row the details came from, so an admin is not left guessing
        //   why a member's profile is fuller than the record they opened.
        ...(sibling ? { _detailsFromMemberRow: sibling.id || null } : {}),
    };
}

/**
 * `row`, with any identity field it lacks filled in from the member's other
 * membership row.
 *
 * For callers that already have a fallback chain of their own and need the
 * sibling inserted UNDERNEATH the row and ABOVE everything else — the members
 * export, whose chain digs through serviceRegistrations and is richer than
 * mergeMemberIdentity's. Filling the row first leaves that chain untouched and
 * simply gives it less to do.
 *
 * Absent means absent: a field the row has is never replaced, so this can only
 * turn a blank cell into a filled one.
 */
export function fillFromSibling<T extends Record<string, any>>(
    row: T,
    sibling: Record<string, any> | null,
): T {
    if (!sibling) return row;
    const out: Record<string, any> = { ...row };
    for (const k of IDENTITY_FIELDS) {
        if (!present(out[k]) && present(sibling[k])) out[k] = sibling[k];
    }
    return out as T;
}
