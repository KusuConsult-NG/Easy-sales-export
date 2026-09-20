import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { erasedOwnerMarker } from "@/lib/user-erasure";
import { logger } from "@/lib/logger";
import { ownedProfileIdsFor, filterByOwner } from "@/lib/owned-profile-ids";

/**
 * Right-to-erasure, for the rows the USER DOCUMENT is not.
 *
 *   #376 ERASURE SCRUBBED ONE ROW OUT OF NINE. EVERY MODULE KEPT ITS OWN COPY
 *        OF THE MEMBER'S NAME, PHONE, ADDRESS AND BANK DETAILS.
 *
 *        #283 fixed the list of fields. #371 fixed the SPELLINGS of those
 *        fields. Both worked on `users`, and both recorded the same open
 *        question at the end: saveKYCProfileAction fans the member's identity
 *        out across the module collections, and "this patch is a user-row patch
 *        and does not reach them".
 *
 *        It is not only that sync. Every module's own onboarding writes a full
 *        copy at submission time, and the admin profile editor
 *        (admin/_applications.ts) writes a third. So after a right-to-erasure
 *        request the user row said "Redacted User" and:
 *
 *          cooperative_members             full name, date of birth, gender,
 *                                          email, phone, residential address,
 *                                          occupation, NEXT OF KIN (a third
 *                                          party), BVN and NIN in clear, the
 *                                          bank account, and the Cloudinary
 *                                          links to the ID scan, passport photo
 *                                          and proof of address
 *          wave_applications               fifty fields including next of kin,
 *                                          the voter's card number, the bank
 *                                          account and the residential address
 *          seller_verifications            phone, NIN, BVN and CAC IN CLEAR
 *                                          (only the copy mirrored onto the
 *                                          user row is hashed), the bank
 *                                          account under TWO roots, the address
 *                                          and the uploaded documents
 *          export_onboarding_applications  profile, kyc.nin and kyc.bvn IN
 *                                          CLEAR, kyc.documents, the bank block
 *          academy_applications            personalInfo: name, email, phone,
 *                                          date of birth, gender, state, LGA
 *          farm_nation_applications        profile: name, email, phone
 *          wave_members                    name, email, phone
 *          marketplace_sellers             business name, email, phone, state
 *
 *        THE RECORDED FINDING SAID FIVE COLLECTIONS. IT IS EIGHT. The five were
 *        the ones the KYC sync touches; the other three were found by following
 *        the writers rather than the sync. That is the N-doors shape again, and
 *        the reason this module lists its targets as data: a hand-written list
 *        in one file is exactly how #283's omission happened.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------
 * Nothing is deleted. The owner's standing instruction for this codebase is to
 * fix the errors and keep the data safe, and #300 settled the shape: a related
 * row is MARKED with erasedOwnerMarker and keeps its status, dates, balances
 * and ids, so a payout that is still owed can still be found. What goes is the
 * copy of the person's identity.
 *
 * The Cloudinary references on those rows are COPIED INTO THE RETENTION RECORD
 * FIRST. #292 established that nothing in this codebase ever removes an asset,
 * so dropping the link without retaining it destroys the only record of whose
 * the file was — "removing the evidence rather than the data". The same rule
 * that applies to `users.documents` applies here.
 *
 * NOT covered, on purpose: transaction records — orders, escrows, land
 * listings, purchase requests. Those name a COUNTERPARTY who is entitled to
 * their copy of what they took part in, and #300 keeps the ledger intact. A
 * module application is a record about the member alone.
 *
 * HOW ROWS ARE FOUND, AND THE ONE GAP THAT IS LEFT OPEN
 * ----------------------------------------------------
 * Every target is swept by `where("userId","==",uid)` AND by the deterministic
 * document ids its writers use — `doc(uid)`, `legacy_<uid>`, `manual_<uid>` —
 * because the id shapes differ per collection and per writer, and neither route
 * alone finds them all. actions/user.ts marked seller_verifications at
 * `doc(userId)` only, which is the wrong id for every row the two server-action
 * creators write.
 *
 * Rows carrying NO userId and no deterministic id are NOT matched on email.
 * cooperative_members is known to contain such rows — the app heals them by
 * email elsewhere — but #36 was opened precisely because matching an
 * application on a free-text email adopted somebody else's record, and a scrub
 * that lands on the wrong row cannot be undone by any amount of retention.
 * Stated rather than hidden: this is the residue, and the healing paths remove
 * it over time by writing the userId back.
 */

/** One collection this sweep is responsible for. */
export interface ModuleErasureTarget {
    /** The collection name, from COLLECTIONS — never a typed string (#373). */
    collection: string;
    /** Document ids its writers derive from the user id, besides any random id. */
    deterministicIds: (userId: string) => string[];
    /**
     * The fields carrying the member's own identifying details. A nested root
     * is named as a root: removing it removes everything under it, and every
     * reader of these reaches them through optional chaining.
     */
    pii: readonly string[];
    /**
     * Where this row keeps uploaded-document references, so they can be copied
     * into the retention record before the field goes. Dotted paths allowed.
     */
    documentPaths: readonly string[];
    /**
     * Fields holding the person's own email address.
     *
     *   #732 — ONLY FOR A COLLECTION WHOSE ROWS CARRY NO userId AT ALL, and
     *   only consulted when the caller supplies the address it read before the
     *   user row was scrubbed.
     *
     *   The header above records why email matching is refused in general, and
     *   that reasoning is sound for a collection where SOME rows have a userId:
     *   the userId route finds those, and an email match only adds risk. The
     *   briefing register is the other case — NO row has ever carried a userId,
     *   so "no email matching" means "never erased at all".
     */
    emailKeys?: readonly string[];
    /**
     * Retain every PII VALUE before scrubbing, not just document references.
     *
     * Required alongside `emailKeys`: the header's objection to email matching
     * is that "a scrub that lands on the wrong row cannot be undone", and this
     * is what makes it undoable. Asserted in the test file rather than left to
     * whoever adds the next target.
     */
    retainPii?: boolean;
}

export const MODULE_ERASURE_TARGETS: readonly ModuleErasureTarget[] = [
    {
        /*
         *   #732 THE TENTH PLACE A PERSON'S PHONE NUMBER LIVES, AND ERASURE
         *        REACHED NINE.
         *
         *   #697 made the broadcast audiences skip an erased account, and
         *   stated plainly why an erased member was already safe:
         *
         *       "`phone` and `phoneNumber` are in ERASED_FIELDS and deleted
         *        outright, and #376 scrubs the same numbers off all eight
         *        module rows — which is where the supplements below read most
         *        of their numbers. An erased member has no number left to
         *        reach."
         *
         *   The briefing register is the ninth collection and was not one of
         *   the eight. It stores fullName, firstName, lastName, otherName,
         *   phoneNumber, email, state and gender, and NOTHING erased it — so an
         *   erased person did have a number left to reach, and the SMS audience
         *   `wave_briefing_registrants` reads `r.phone || r.phoneNumber`
         *   straight off the row with no contactability check at all.
         *
         *   MATCHED BY EMAIL, WHICH THIS MODULE REFUSES EVERYWHERE ELSE, and
         *   the difference is why. The header's rule protects a collection
         *   where SOME rows carry a userId: the userId route finds those, so an
         *   email match only adds the risk of landing on somebody else's
         *   record. NO briefing row has ever carried a userId — the registration
         *   is a guest form and writes none — so the same rule would mean this
         *   collection is never erased at all, which is not a decision anybody
         *   made. It was absent from the list, not excluded from it.
         *
         *   AND THE RISK IS BOUNDED ON BOTH SIDES. The registration refuses a
         *   duplicate email outright, so a match is at most one row; and
         *   `retainPii` copies every value into the retention record before the
         *   scrub, so the objection the header raises — "cannot be undone by
         *   any amount of retention" — no longer holds for this target.
         *
         *   Phone is deliberately NOT a match key. The registration's own note
         *   records that a handset can be shared, and an address is the only
         *   identifier here that one person holds alone.
         */
        collection: COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS,
        //   A guest form: `.add()` with no userId and no derived id, so there
        //   is nothing for the deterministic route to try.
        deterministicIds: () => [],
        emailKeys: ["email"],
        retainPii: true,
        pii: [
            "fullName", "firstName", "lastName", "otherName", "name", "surname",
            "phoneNumber", "phone", "email", "gender", "state",
        ],
        documentPaths: [],
    },
    {
        // personalInfo is the whole identity block; the flat spellings are what
        // the zod AcademyApplicationSchema and the KYC sync write beside it.
        collection: COLLECTIONS.ACADEMY_APPLICATIONS,
        deterministicIds: (uid) => [`legacy_${uid}`, `manual_${uid}`],
        pii: ["personalInfo", "fullName", "phone", "state", "email", "userEmail"],
        documentPaths: [],
    },
    {
        // The widest row in the platform, and the one with three spellings of
        // next of kin — nested `nextOfKin` (onboarding and legacy import), flat
        // `nextOfKinName`/`Phone`/`Address` (resubmission), and
        // `nextOfKin.fullName`/`residentialAddress` (the /api register route).
        // All three are covered: the nested root and the flat trio.
        collection: COLLECTIONS.COOPERATIVE_MEMBERS,
        deterministicIds: (uid) => [uid, `legacy_${uid}`],
        pii: [
            "firstName", "middleName", "otherName", "lastName", "fullName",
            "dateOfBirth", "gender", "email", "phone",
            // `address` is the KYC sync's flat spelling; `residentialAddress`
            // is onboarding's. They are the same datum under two names.
            "stateOfOrigin", "state", "lga", "ward", "residentialAddress", "address",
            "occupation",
            "nextOfKin", "nextOfKinName", "nextOfKinPhone", "nextOfKinAddress",
            "documents",
            // Written in CLEAR on this row, unlike the WAVE application.
            "bvn", "nin",
            "bankDetails", "bankAccountNumber", "bankAccountName",
            "bankName", "bankCode", "accountNumber", "accountName",
        ],
        documentPaths: ["documents"],
    },
    {
        // Flat throughout — the fifty-field form has no nested objects. `phone`
        // and `phoneNumber` are both live: the multi-step form writes the
        // first, the legacy import and the admin editor write the second.
        collection: COLLECTIONS.WAVE_APPLICATIONS,
        deterministicIds: (uid) => [`legacy_${uid}`],
        pii: [
            "surname", "firstName", "otherNames", "fullName",
            "dateOfBirth", "age", "gender",
            "phone", "phoneNumber", "alternativePhone", "email", "userEmail",
            "residentialAddress", "stateOfOrigin", "lgaOfOrigin",
            "stateOfResidence", "lgaOfResidence", "residentialState", "state",
            "maritalStatus",
            "nextOfKinName", "nextOfKinPhone", "nextOfKinRelationship",
            // nin and bvn are hashed here; the voter's card is not, on this row
            // or on the user document — the same asymmetry #371 recorded.
            "nin", "bvn", "votersCardNumber", "pollingUnit", "ward",
            "yearOfVoterRegistration",
            "currentOccupation", "bankName", "accountNumber",
            // The deprecated single-page form's own spelling.
            "businessName",
        ],
        documentPaths: [],
    },
    {
        collection: COLLECTIONS.WAVE_MEMBERS,
        deterministicIds: (uid) => [uid],
        pii: ["name", "email", "phone"],
        documentPaths: [],
    },
    {
        // Two roots for one bank account (`bankAccount` and `bankDetails`, both
        // written by the API route and the legacy import), and two roots for
        // one address (`address` from the server action, `location` from
        // onboarding). All four go.
        collection: COLLECTIONS.SELLER_VERIFICATIONS,
        deterministicIds: (uid) => [uid, `legacy_${uid}`],
        pii: [
            "phone", "phoneNumber", "email", "userEmail",
            "businessName", "businessDescription",
            // In CLEAR on this row. Only the copies mirrored onto the user
            // document are hashed.
            "nin", "bvn", "cac", "cacNumber",
            "bankAccount", "bankDetails",
            "address", "location", "state", "lga",
            "documents",
        ],
        documentPaths: ["documents"],
    },
    {
        collection: COLLECTIONS.MARKETPLACE_SELLERS,
        deterministicIds: (uid) => [uid],
        pii: ["businessName", "email", "phone", "state", "lga"],
        documentPaths: [],
    },
    {
        // `kyc` carries nin, bvn and the document URLs; `profile` the name,
        // phone and address; `bank` the account. `state`/`lga` are flat on the
        // legacy row and nested under `profile` on the real one, so both.
        collection: COLLECTIONS.EXPORT_APPLICATIONS,
        deterministicIds: (uid) => [`legacy_${uid}`],
        pii: ["profile", "kyc", "bank", "companyInfo", "userEmail", "state", "lga"],
        documentPaths: ["kyc.documents"],
    },
    {
        collection: COLLECTIONS.FARM_NATION_APPLICATIONS,
        deterministicIds: (uid) => [`legacy_${uid}`],
        pii: ["profile", "userEmail"],
        documentPaths: [],
    },
] as const;

/**
 * The patch applied to one module row: the identity fields go, the record
 * stays, and the row says why it is inert.
 */
export function moduleErasurePatch(
    target: ModuleErasureTarget,
    userId: string,
): Record<string, unknown> {
    const patch: Record<string, unknown> = { ...erasedOwnerMarker(userId) };

    for (const field of target.pii) {
        patch[field] = FieldValue.delete();
    }

    return patch;
}

/** A document reference kept before the row loses it — #292/#300. */
export interface RetainedModuleDocument {
    collection: string;
    docId: string;
    path: string;
    value: unknown;
}

/** Reads a dotted path out of a row without throwing on a missing parent. */
function readPath(data: Record<string, any> | undefined | null, path: string): unknown {
    let cursor: any = data;
    for (const key of path.split(".")) {
        if (cursor === null || cursor === undefined) return undefined;
        cursor = cursor[key];
    }
    return cursor;
}

export function retainedDocumentsFrom(
    target: ModuleErasureTarget,
    docId: string,
    data: Record<string, any> | undefined | null,
): RetainedModuleDocument[] {
    const out: RetainedModuleDocument[] = [];

    for (const path of target.documentPaths) {
        const value = readPath(data, path);
        if (value === undefined || value === null) continue;
        out.push({ collection: target.collection, docId, path, value });
    }

    /*
     *   #732 — AND THE PII ITSELF, FOR AN EMAIL-MATCHED TARGET.
     *
     *   A row found by document reference or userId was found by something the
     *   platform is certain about. A row found by a free-text email was not,
     *   and the header's objection to matching on one is exactly that the scrub
     *   "cannot be undone by any amount of retention". Retaining the values is
     *   what answers that: the row can be put back from this record.
     *
     *   Kept under the same shape as a document reference so the retention
     *   record needs no second format, and skipped where the value is absent so
     *   a second erasure pass over an already-scrubbed row adds nothing.
     */
    if (target.retainPii) {
        for (const field of target.pii) {
            if (target.documentPaths.includes(field)) continue;
            const value = readPath(data, field);
            if (value === undefined || value === null) continue;
            out.push({ collection: target.collection, docId, path: field, value });
        }
    }

    return out;
}

export interface ModuleErasureResult {
    /** False when any collection could not be swept — the caller must say so. */
    ok: boolean;
    /** Rows patched, across every target. */
    rowsScrubbed: number;
    /** Document references copied into the retention record first. */
    retained: RetainedModuleDocument[];
    /** One entry per collection that failed, named so a retry knows where. */
    failures: string[];
}

/**
 * Scrub every module row belonging to this user.
 *
 * Called by all three erasure doors — the member's own deleteAccountAction, the
 * admin deletion in admin_extensions.ts, and the GDPR purge cron. One of them
 * having it and the others not is the defect this closes, so it is a shared
 * function rather than three copies.
 *
 * A failure is REPORTED, never swallowed. The KYC sync that writes these rows
 * catches its own errors and logs a warning, which is right for a convenience
 * sync and wrong for an erasure: telling somebody their data is gone when a
 * collection could not be reached is the outcome this whole path exists to
 * avoid.
 */
/** What the caller read off the user row BEFORE scrubbing it — #732. */
export interface ErasureContact {
    /** The person's address as stored, before userErasurePatch replaced it. */
    email?: string | null;
}

export async function eraseModuleApplications(
    userId: string,
    contact: ErasureContact = {},
): Promise<ModuleErasureResult> {
    /*
     *   #732 — READ BEFORE THE SCRUB, PASSED IN, NEVER RE-READ HERE.
     *
     *   Every caller scrubs the user row BEFORE calling this (soft-delete step
     *   2 precedes step 3), so by the time this runs the address on that row is
     *   already `deleted_<uid>@redacted.local`. Looking it up here would find
     *   the tombstone and match nothing. The one moment the link exists is
     *   before the scrub, which is where the callers now capture it.
     */
    const erasureEmail = String(contact.email ?? "").trim().toLowerCase();

    /**
     *   EVERY PROFILE ROW THIS PERSON HAS, NOT ONLY THE ONE THEY LAST SIGNED
     *   IN AS.
     *
     *   #376's finding was that erasure "scrubbed one row out of nine" —
     *   every module keeps its own copy of the member's name, phone, address,
     *   next of kin, BVN and bank account. This is the same finding one axis
     *   over: the rows are found by `userId`, and a member whose profile was
     *   superseded has module rows filed under the id they no longer use.
     *   765 profiles in production carry that pointer.
     *
     *   So a right-to-erasure request could scrub the live profile's WAVE
     *   application and leave the superseded profile's — same person, same
     *   NIN, same bank account, still on the platform, still readable by
     *   every admin screen.
     *
     *   BOTH LOOKUPS NEEDED IT, and the second is easy to miss:
     *   `deterministicIds(userId)` derives document ids FROM the id it is
     *   given, so passing only the live one cannot reach a row keyed on the
     *   old one however many collections are swept.
     *
     *   THE EMAIL SWEEP IS DELIBERATELY NOT WIDENED. It is already keyed on
     *   the address rather than on any profile, and #36's rule stands: an
     *   email match is a CLAIM, not proof of ownership.
     *
     *   FAILING CLOSED IS NOT AN OPTION HERE, and failing open is not either.
     *   ownedProfileIds returns [liveId] when resolution fails, so a lookup
     *   error narrows this to exactly today's behaviour rather than widening
     *   it to rows that may not be theirs.
     */
    const ownedIds = await ownedProfileIdsFor(userId);

    const retained: RetainedModuleDocument[] = [];
    const failures: string[] = [];
    const patches: Array<{ target: ModuleErasureTarget; docId: string }> = [];

    for (const target of MODULE_ERASURE_TARGETS) {
        try {
            const seen = new Set<string>();

            const snapshot = await filterByOwner(
                db.collection(target.collection), "userId", ownedIds,
            ).get();

            for (const doc of snapshot.docs) {
                seen.add(doc.id);
                retained.push(...retainedDocumentsFrom(target, doc.id, doc.data()));
                patches.push({ target, docId: doc.id });
            }

            // The id shapes the writers derive from the user id. A row created
            // before the userId field existed carries no userId, and the query
            // above cannot see it.
            //   Derived for EVERY id this person owns — see the header. A
            //   deterministic id built from the live profile cannot name a row
            //   keyed on the superseded one.
            const deterministic = ownedIds.flatMap((id) => target.deterministicIds(id));
            for (const docId of deterministic) {
                if (seen.has(docId)) continue;
                const snap = await db.collection(target.collection).doc(docId).get();
                if (!snap.exists) continue;
                seen.add(docId);
                retained.push(...retainedDocumentsFrom(target, docId, snap.data()));
                patches.push({ target, docId });
            }

            /*
             *   #732 — and the address, for a collection whose rows carry no
             *   userId at all. Only when the target opts in AND the caller
             *   supplied an address: absent either, this does nothing, so no
             *   existing target changes behaviour.
             */
            if (target.emailKeys && erasureEmail) {
                for (const key of target.emailKeys) {
                    const byEmail = await db
                        .collection(target.collection)
                        .where(key, "==", erasureEmail)
                        .get();
                    for (const doc of byEmail.docs) {
                        if (seen.has(doc.id)) continue;
                        seen.add(doc.id);
                        retained.push(...retainedDocumentsFrom(target, doc.id, doc.data()));
                        patches.push({ target, docId: doc.id });
                    }
                }
            }
        } catch (error) {
            logger.error("[erasure] module sweep failed", {
                userId,
                collection: target.collection,
                error: error instanceof Error ? error.message : String(error),
            });
            failures.push(target.collection);
        }
    }

    // The references FIRST, and only when there are any: a later erasure pass
    // over an already-scrubbed account finds none, and writing an empty array
    // over a merge would erase what the first pass retained.
    if (retained.length > 0) {
        try {
            await db.collection(COLLECTIONS.ERASURE_RETENTION).doc(userId).set(
                { userId, moduleDocuments: retained, retainedAt: new Date().toISOString() },
                { merge: true },
            );
        } catch (error) {
            logger.error("[erasure] retention of module document references failed", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            // Nothing is scrubbed if the references could not be kept. Removing
            // the only record of whose the uploaded files are, while the files
            // themselves are never removed, is the trade #292 refused.
            return { ok: false, rowsScrubbed: 0, retained, failures: [...failures, "retention"] };
        }
    }

    let rowsScrubbed = 0;
    if (patches.length > 0) {
        try {
            const batch = db.batch();
            for (const { target, docId } of patches) {
                batch.set(
                    db.collection(target.collection).doc(docId),
                    moduleErasurePatch(target, userId),
                    { merge: true },
                );
            }
            await batch.commit();
            rowsScrubbed = patches.length;
        } catch (error) {
            logger.error("[erasure] module scrub commit failed", {
                userId,
                rows: patches.length,
                error: error instanceof Error ? error.message : String(error),
            });
            return { ok: false, rowsScrubbed: 0, retained, failures: [...failures, "commit"] };
        }
    }

    return { ok: failures.length === 0, rowsScrubbed, retained, failures };
}
