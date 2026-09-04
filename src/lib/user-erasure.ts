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
 *
 *   #371 #283's OWN DEFECT, STILL LIVE IN THIS FILE: THE LIST NAMES ONE
 *        SPELLING OF FIELDS THIS CODEBASE GUARANTEES EXIST IN TWO.
 *
 *        #283's headline was "on the fields the codebase stores twice, erasure
 *        removed the copy somebody thought of and left the copy added later".
 *        It fixed the three duplications it could see by reading the User type.
 *        It could not see the rest, and the rest are not a coincidence — a
 *        module exists whose entire job is to create them.
 *
 *        THE NORMALISER MAKES THE SECOND COPY. Every write to the user document
 *        goes through atomicUpdateUser, which calls normalizeUserUpdate. Three
 *        of that function's four rules are aliases (verified by running it):
 *
 *            { phone }        -> { phone, phoneNumber }
 *            { fullName }     -> { fullName, name }
 *            { displayName }  -> { displayName, name, fullName }
 *
 *        The old list erased `phone` and replaced `fullName`. It named neither
 *        `phoneNumber` nor `name` nor `displayName`. So a right-to-erasure
 *        request set fullName to "Redacted User" and left `name` holding the
 *        person's real name, and deleted `phone` while `phoneNumber` kept their
 *        number — not by accident of drift, but because a normaliser had
 *        guaranteed both were there.
 *
 *        AND FOUR NESTED ROOTS HELD A COMPLETE SECOND IDENTITY PROFILE.
 *        saveKYCProfileAction fans one form into several roots of the user row
 *        at once; verifyBVNAction / verifyNINAction / verifyVotersCardAction add
 *        the identity numbers to the first of them:
 *
 *          kyc                 firstName, lastName, otherNames, fullName,
 *                              dateOfBirth, phoneNumber, address, city, state,
 *                              idType, idNumber — plus nin and bvn (hashed) and
 *                              votersCard, which is stored in PLAINTEXT while
 *                              its two siblings are hashed
 *          verificationProfile firstName, lastName, fullName, dob, phone
 *          farmNation          farmNation.profile, which carries the member's
 *                              profile and full name (_fn_onboarding.ts)
 *          city                a top-level field, written beside the flat
 *                              `residentialAddress` the old list did erase
 *
 *        None was named. And the #283 ratchet could not raise any of it: it
 *        checks ERASED_FIELDS against `interface User` in lib/types/shared.ts,
 *        and that interface declares no `kyc`, no `verificationProfile`, no
 *        `farmNation`, no `city`, no `phoneNumber`, no `name` and no
 *        `displayName`. A ratchet that reads one type cannot see what a
 *        normaliser and a dot-path write put on the row beside it.
 *
 *        Both halves are closed below, and the new ratchet in
 *        erasure-covers-every-spelling.test.ts derives the aliases from
 *        normalizeUserUpdate itself and sweeps the dotted write paths, so
 *        neither shape can come back quietly.
 *
 *        RECORDED, NOT CHANGED: saveKYCProfileAction ALSO copies the member's
 *        name, phone, state and address into academy_applications,
 *        cooperative_members, wave_applications, seller_verifications and
 *        export_onboarding_applications. This patch is a user-row patch and
 *        does not reach them, and #300 settled that related rows are MARKED
 *        rather than scrubbed. Which of those two an erasure request should do
 *        to a module application is the owner's call.
 */

/**
 * Personal fields removed outright. Grouped by why, so a reviewer can check the
 * reasoning rather than the length.
 */
export const ERASED_FIELDS = [
    // Name, in every spelling this codebase writes.
    "firstName", "lastName", "otherName",

    // Contact and demography.
    //
    // #371 `phoneNumber` is not a second guess at the field name — it is
    // GUARANTEED to be on the row beside `phone`, because normalizeUserUpdate
    // rule 3 mirrors the two on every write through atomicUpdateUser. Erasing
    // one of a mirrored pair leaves the number intact under the other key.
    "phone", "phoneNumber", "gender", "dateOfBirth", "occupation",

    // Address, nested AND flat. #371 adds `city`, which saveKYCProfileAction
    // writes at the top level right beside the `residentialAddress` that was
    // already here.
    "address", "residentialAddress", "stateOfOrigin", "lga", "city",

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
    //
    //   #292 REMOVING THE LINK DOES NOT REMOVE THE FILE, AND THIS IS WHERE
    //        THAT STOPS BEING A DETAIL.
    //
    //        Nothing in this codebase deletes a Cloudinary asset. Every
    //        reference to api.cloudinary.com — actions/upload.ts,
    //        api/upload/route.ts, lib/storage-admin.ts — is an /upload call.
    //        There is no destroy, no admin API call, no lifecycle rule.
    //
    //        So the ID scan, passport photo and proof of address survive this
    //        patch untouched and, per #280, publicly readable with no expiry.
    //        Worse: this field was the platform's only record of WHICH assets
    //        belonged to the person. A Cloudinary public_id is derivable from
    //        its URL, so BEFORE erasure a purge is possible by parsing the
    //        stored URLs; AFTER it, the file is still public and nothing here
    //        can say whose it was.
    //
    //        A right-to-erasure request therefore removed the evidence rather
    //        than the data.
    //
    //        SETTLED BY THE OWNER, and settled the other way round from the way
    //        this note anticipated: nothing is to be deleted, on Cloudinary or
    //        anywhere else. So the asset is not purged — the REFERENCE is kept,
    //        copied into a server-only retention record before this patch runs.
    //        See erasureRetentionRecord below and #300. The field still goes
    //        from the user row; what changed is that it no longer goes nowhere.
    "documents",

    // Credentials and second factors.
    "totpSecret", "mfaRecoveryCodes",

    // Per-module registration detail, which carries application ids and dates.
    "serviceRegistrations",

    /**
     *   #371 THE NESTED ROOTS, WHICH HELD A COMPLETE SECOND IDENTITY PROFILE.
     *
     *        None of these is declared on `interface User`, which is why the
     *        #283 ratchet could not raise them. They are written by dot-path,
     *        so the row carries them all the same.
     *
     *          kyc                  saveKYCProfileAction writes the whole form
     *                               under it — name, date of birth, phone,
     *                               address, city, state, ID type and number —
     *                               and verifyBVNAction / verifyNINAction /
     *                               verifyVotersCardAction add the identity
     *                               numbers. nin and bvn are hashed; votersCard
     *                               is stored in PLAINTEXT.
     *          verificationProfile  the same action's "Canonical Profile Sync":
     *                               firstName, lastName, fullName, dob, phone.
     *          farmNation           farmNation.profile, from _fn_onboarding.ts,
     *                               carries the member's profile and full name.
     *
     *        Deleting the root removes the whole object, which is what is
     *        wanted: every reader of these reaches them through optional
     *        chaining (`data.kyc?.…`), so an absent object is the shape they
     *        already handle. The record that the person WAS verified survives
     *        where #300 put it — the kyc_verifications rows, marked with
     *        erasedOwnerMarker rather than deleted.
     */
    "kyc", "verificationProfile", "farmNation",
] as const;

/**
 * The patch a right-to-erasure request applies to the user document.
 *
 * `fullName` and `email` are REPLACED rather than deleted: several screens read
 * them unconditionally and would render "undefined", and the email placeholder
 * is what lib/auth.ts is handed when the credential is revoked.
 *
 *   #371 `name` AND `displayName` GET THE SAME TREATMENT, BECAUSE THEY ARE THE
 *        SAME VALUE. normalizeUserUpdate rule 4 writes `name` from `fullName`
 *        and writes BOTH from `displayName`. So redacting fullName alone left
 *        the person's real name on the row under `name` — the exact shape #283
 *        was opened for, on the field #283 chose as its example.
 *
 *        They are replaced rather than deleted for fullName's own reason: the
 *        normaliser treats the three as one value, and leaving two of them
 *        absent while the third says "Redacted User" would put the aliases back
 *        into disagreement on the very next write.
 */
export function userErasurePatch(userId: string): Record<string, unknown> {
    const patch: Record<string, unknown> = {
        fullName: "Redacted User",
        name: "Redacted User",
        displayName: "Redacted User",
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

/**
 * What the erasure MOVES rather than destroys.
 *
 *   #300 ERASURE DESTROYED RECORDS INSTEAD OF RETIRING THEM.
 *
 *        Owner decision, and it settles #280/#292: nothing is to be deleted —
 *        not a Cloudinary asset, and not a row that was wrongly programmed. The
 *        code gets fixed and the data stays recoverable.
 *
 *        Three things in deleteAccountAction were outright destruction:
 *
 *          batch.delete on every KYC_VERIFICATIONS row for the user
 *          batch.delete on the SELLER_VERIFICATIONS row
 *          batch.delete on the WALLET
 *
 *        The wallet one contradicts the function's own comment two lines below
 *        it, which says the uid is kept "so that database foreign keys do not
 *        break". A wallet is the other end of exactly those keys: every
 *        wallet_transactions row points at it. The blocker check above refuses
 *        to erase an account holding a balance, so nothing was lost in NAIRA —
 *        what was lost is the record that the account existed at all.
 *
 *        And `documents` was deleted from the user row, which is the only place
 *        that recorded WHICH Cloudinary assets were that person's. The assets
 *        are never removed (nothing in this codebase deletes one), so erasure
 *        was destroying the index and leaving the files — the worst of both.
 *
 *        Now: the references are copied here first, and the three rows are
 *        MARKED rather than deleted.
 *
 * WHERE THIS SITS, AND WHY THAT IS SAFE
 * -------------------------------------
 * COLLECTIONS.ERASURE_RETENTION is inside document_collections, which
 * migration 004 put under RLS with no policies at all. Only the service key
 * reaches it; no browser session, no member, no admin screen. It is a record
 * for the controller, not a second copy on a page.
 *
 * THE TENSION, STATED RATHER THAN HIDDEN
 * --------------------------------------
 * Retaining identity-document links after a right-to-erasure request is a
 * position, not a neutral default. It is the owner's decision and it is applied
 * here as given; the mitigation is that the retained record is server-only and
 * carries links rather than the documents themselves. If the position changes
 * later, this is the one place that has to change.
 */
export function erasureRetentionRecord(
    userId: string,
    user: Record<string, any> | undefined | null,
): Record<string, unknown> {
    return {
        userId,
        // The Cloudinary references. Without these, the assets outlive the only
        // record of whose they were.
        documents: user?.documents ?? null,
        // Enough to identify the person to a regulator or to themselves if they
        // come back — deliberately NOT the full profile.
        emailAtErasure: user?.email ?? null,
        retainedAt: new Date().toISOString(),
        reason: "right_to_erasure",
    };
}

/**
 * The patch that RETIRES a related record instead of deleting it — #300.
 *
 * Used for the KYC verification rows, the seller verification row and the
 * wallet. Everything already on the row stays; what is added is the fact that
 * the owner exercised erasure, so a reader knows why the row is inert.
 */
export function erasedOwnerMarker(userId: string): Record<string, unknown> {
    return {
        ownerErased: true,
        ownerErasedAt: new Date().toISOString(),
        ownerErasedUserId: userId,
    };
}
