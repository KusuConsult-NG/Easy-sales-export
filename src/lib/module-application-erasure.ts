import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { erasedOwnerMarker } from "@/lib/user-erasure";
import { logger } from "@/lib/logger";

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
}

export const MODULE_ERASURE_TARGETS: readonly ModuleErasureTarget[] = [
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
export async function eraseModuleApplications(userId: string): Promise<ModuleErasureResult> {
    const retained: RetainedModuleDocument[] = [];
    const failures: string[] = [];
    const patches: Array<{ target: ModuleErasureTarget; docId: string }> = [];

    for (const target of MODULE_ERASURE_TARGETS) {
        try {
            const seen = new Set<string>();

            const snapshot = await db
                .collection(target.collection)
                .where("userId", "==", userId)
                .get();

            for (const doc of snapshot.docs) {
                seen.add(doc.id);
                retained.push(...retainedDocumentsFrom(target, doc.id, doc.data()));
                patches.push({ target, docId: doc.id });
            }

            // The id shapes the writers derive from the user id. A row created
            // before the userId field existed carries no userId, and the query
            // above cannot see it.
            for (const docId of target.deterministicIds(userId)) {
                if (seen.has(docId)) continue;
                const snap = await db.collection(target.collection).doc(docId).get();
                if (!snap.exists) continue;
                seen.add(docId);
                retained.push(...retainedDocumentsFrom(target, docId, snap.data()));
                patches.push({ target, docId });
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
