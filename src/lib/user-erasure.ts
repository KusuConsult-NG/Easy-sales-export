import { FieldValue } from "@/lib/firestore-compat";

/**
 * What a right-to-erasure request actually has to remove from a user document.
 *
 *   #283 THE ERASURE SCRUB DELETED THE NESTED COPY AND LEFT THE FLAT ONE.
 *
 *        deleteAccountAction's own comment says "Scrub all PII". It removed
 *        ten fields:
 *
 *            fullName, email, phone, gender, address, bankDetails,
 *            serviceRegistrations, mfaEnabled, totpSecret, mfaRecoveryCodes
 *
 *        A user document carries considerably more than that, and the fields it
 *        missed are the ones that matter most:
 *
 *          bvn, nin              Nigerian national identity numbers
 *          nextOfKin             A THIRD PARTY's name, phone and address —
 *                                somebody who never consented and cannot
 *                                request their own erasure here
 *          documents             URLs to the ID scan, passport photo and proof
 *                                of address. Per #280 those URLs are PUBLIC
 *                                Cloudinary links with no expiry, so after
 *                                "deletion" the person's ID document is still
 *                                downloadable and the link is still on the row
 *          dateOfBirth, occupation, stateOfOrigin, lga, votersCardNumber,
 *          taxId, cacNumber, companyName, idNumber
 *
 *        AND IT DELETED ONE COPY OF TWO DUPLICATED FIELDS.
 *
 *        `address` was deleted while `residentialAddress` — the flat copy the
 *        type describes as "Synced globally for dispatch/delivery routing" —
 *        stayed. `bankDetails` was deleted while `bankAccountNumber`,
 *        `bankAccountName` and `bankCode` stayed; the type says in a comment
 *        that those are "written directly by payout actions". `fullName` became
 *        "Redacted User" while `firstName`, `lastName` and `otherName` kept the
 *        person's actual name.
 *
 *        So on the fields the codebase stores twice, erasure removed the copy
 *        somebody thought of and left the copy that was added later. That is
 *        #85's shape ("the admin user table skipped users.name") turned into a
 *        compliance failure.
 *
 * WHY THIS IS A MODULE AND NOT A LONGER LIST IN user.ts
 * ----------------------------------------------------
 * Because a hand-written list in one file is exactly how the omission
 * happened, and there is more than one deletion path — see the note on
 * bulk-user-operations.ts below. The set lives here, once, and
 * user-erasure.test.ts checks it against the User type, so a NEW PII field
 * added to that type fails the build rather than quietly surviving erasure.
 *
 * WHAT IS DELIBERATELY KEPT
 * -------------------------
 * `uid`, and the deletion bookkeeping. The original comment explains uid: it is
 * retained so foreign keys like an order's `sellerId` do not break. `roles` is
 * kept too — an account marked deleted and suspended is refused at login, and
 * dropping its roles would change what historical records mean without making
 * the person any less identifiable.
 */

/**
 * Personal fields removed outright. Grouped by why, so a reviewer can check the
 * reasoning rather than the length.
 */
export const ERASED_FIELDS = [
    // Name, in every spelling this codebase writes.
    "firstName", "lastName", "otherName",

    // Contact and demography.
    "phone", "gender", "dateOfBirth", "occupation",

    // Address, nested AND flat.
    "address", "residentialAddress", "stateOfOrigin", "lga",

    // A third party's details.
    "nextOfKin",

    // Bank, nested AND flat.
    "bankDetails", "bankAccountNumber", "bankAccountName", "bankCode",

    // Government identity numbers.
    "nin", "bvn", "votersCardNumber", "idType", "idNumber",

    // Business identity.
    "taxId", "cacNumber", "companyName",

    // Identity document URLs. #280: these links are public and unexpiring, so
    // leaving them on the row leaves the documents reachable.
    "documents",

    // Credentials and second factors.
    "totpSecret", "mfaRecoveryCodes",

    // Per-module registration detail, which carries application ids and dates.
    "serviceRegistrations",
] as const;

/**
 * The patch a right-to-erasure request applies to the user document.
 *
 * `fullName` and `email` are REPLACED rather than deleted: several screens read
 * them unconditionally and would render "undefined", and the email placeholder
 * is what lib/auth.ts is handed when the credential is revoked.
 */
export function userErasurePatch(userId: string): Record<string, unknown> {
    const patch: Record<string, unknown> = {
        fullName: "Redacted User",
        email: erasedEmailFor(userId),
        mfaEnabled: false,
    };

    for (const field of ERASED_FIELDS) {
        patch[field] = FieldValue.delete();
    }

    return patch;
}

/** The placeholder address, in one place — auth revocation is handed the same. */
export function erasedEmailFor(userId: string): string {
    return `deleted_${userId}@redacted.local`;
}
