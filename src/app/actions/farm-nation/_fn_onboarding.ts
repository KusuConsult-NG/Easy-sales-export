"use server";

import { requireSession } from "@/lib/session-guard";
import { invalidateServiceCache } from "@/lib/cache-invalidation";
import { checkModuleAccess } from "@/lib/module-access-check";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { rolesForFarmNationRole } from "@/lib/farm-nation-roles";
import { invalidateUserCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { z } from "zod";
import type { FarmNationOnboardingData } from "@/lib/types/farm-nation-actions";
import { requiredNationalIdField } from "@/lib/kyc-validators";
import { hashData } from "@/lib/security";
import { kycReadableField } from "@/lib/kyc-identity-store";
import { latestApplication } from "@/lib/latest-application";
import { ownedProfileIds, ownedProfileIdsFor, filterByOwner } from "@/lib/owned-profile-ids";
import { isLiveUserRow } from "@/lib/user-identity";
import { readUserDocOnce } from "@/lib/current-user-doc";

/**
 * Submit Farm Nation Onboarding
 */
const farmNationOnboardingSchema = z.object({
    role: z.enum(["buyer", "seller", "both"]),
    profile: z.object({
        firstName: z.string().min(2, "First name is required"),
        lastName: z.string().min(2, "Last name is required"),
        otherName: z.string().optional().nullable().or(z.literal("")),
        phone: z.string().min(10, "Phone number is required"),
        businessName: z.string().optional().nullable().or(z.literal("")),
        state: z.string().min(2, "State is required"),
        lga: z.string().min(2, "LGA is required"),
        address: z.string().min(5, "Address is required"),
        /**
         *   #865 THE NUMBERS THE FORM'S OWN KYC NOTICE REFERS TO.
         *
         *   THE OWNER: "add field NIN/BVN but should pass without QoreID
         *   verification."
         *
         *   The onboarding screen told the applicant "Enter your name exactly
         *   as it appears on your NIN/BVN" and hinted the same on two more
         *   fields, and the form collected neither number. Three references to
         *   a document nothing asked for.
         *
         *   DECLARED HERE OR SILENTLY DROPPED. This action parses with a strict
         *   object; a field the client sends and the schema does not name never
         *   reaches the database. That is this audit's most common false
         *   positive — a form that collects an answer nobody keeps — and it is
         *   why the client half alone would have been worth nothing.
         *
         *   `requiredNationalIdField` IS THE OWNER'S OWN RULE, IMPORTED. #774:
         *   "NIN, BVN and voter's cards are mandatory but shouldn't be checked
         *   by QoreID." Nothing in that module contacts any provider — #487
         *   settled that "PASS means do not require an external check" — so
         *   these are eleven digits that are not an obvious placeholder, and
         *   no more. Required, matching WAVE and the owner's standing
         *   instruction, and matching this screen's own copy, which has always
         *   presumed the applicant has both.
         */
        nin: requiredNationalIdField('NIN'),
        bvn: requiredNationalIdField('BVN'),
    }),
    interests: z.object({
        propertyTypes: z.array(z.string()).optional(),
        budgetRange: z.string().optional(),
        preferredSize: z.string().optional(),
        listingTypes: z.array(z.string()).optional(),
        totalAcreage: z.string().optional(),
        readyToList: z.boolean().optional(),
        farmLocation: z.string().optional(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        farmDocuments: z.array(z.string()).optional(),
    }).optional().nullable(),
    terms: z.object({
        termsAccepted: z.boolean(),
        privacyAccepted: z.boolean(),
        feeDisclosureAccepted: z.boolean(),
    })
});



/**
 * The profile as it may be STORED — without the raw identity numbers.
 *
 *   #865 THE FEATURE THAT ONLY HAD TO COLLECT TWO NUMBERS NEARLY LEFT SIX
 *   PLAINTEXT COPIES OF THEM.
 *
 *   `validatedData.profile` is spread or stored at six sites across this file:
 *   the user document and the application row on the submit path, and three
 *   more on the resubmit path that mirror them. Adding `nin` and `bvn` to the
 *   schema put the raw numbers into every one of those writes for free — a new
 *   plaintext copy of the two values this platform is most careful with, in a
 *   nested object nobody would think to look in.
 *
 *   kyc-identity-store is the settled answer: the field's own name holds the
 *   HASH, and an encrypted readable copy sits beside it for a reviewer. The
 *   callers below write that, and this makes sure the profile object itself
 *   carries neither number.
 *
 *   ONE FUNCTION RATHER THAN SIX DELETIONS, because five of six is exactly the
 *   shape this audit keeps finding — and the sixth would be the one that
 *   mattered.
 */
function storableProfile<T extends { nin?: unknown; bvn?: unknown }>(profile: T) {
    const { nin: _nin, bvn: _bvn, ...rest } = profile;
    return rest;
}

async function _submitFarmNationOnboardingAction(data: FarmNationOnboardingData): Promise<ActionResponse<null>> { 
    try {
        // Get authenticated session
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.farmNation?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') { 
            return { success: false as const, error: "Your previous application is still being processed.", data: null, meta: null };
        }
        if (existingStatus === 'approved') { 
            return { success: false as const, error: "You are already registered for Farm Nation.", data: null, meta: null };
        }

        // Validate onboarding data with Zod schema
        const validation = farmNationOnboardingSchema.safeParse(data);
        if (!validation.success) {
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", data: null, meta: null };
        }
        const validatedData = validation.data;

        //   The same rule the ADMIN APPROVAL now asks. It was stated here and
        //   nowhere else, which is why the approval could contradict it — see
        //   lib/farm-nation-roles for what that cost a buyer.
        const roles: string[] = rolesForFarmNationRole(validatedData.role);

        // ── EXECUTE ONBOARDING IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const appRef = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc();

            // Prepare names
            const fullName = [validatedData.profile.firstName, validatedData.profile.otherName, validatedData.profile.lastName]
                .filter(Boolean).join(" ").trim();

            //   #865 Trimmed once, here, so the hash and the encrypted copy are
            //   taken from the same string. Two independent `.trim()` calls is
            //   how a hash stops matching its own readable copy.
            const applicantNin = validatedData.profile.nin.trim();
            const applicantBvn = validatedData.profile.bvn.trim();

            // DISEASE 2 FIX: normalizeUserUpdate mirrors farmNation→farm_nation
            // and phone→phoneNumber so both canonical key variants are always in sync.
            transaction.update(userRef, normalizeUserUpdate({ 
                "farmNation.role": validatedData.role,
                "farmNation.profile": {
                    ...storableProfile(validatedData.profile),
                    fullName
                },
                "farmNation.interests": validatedData.interests,
                "farmNation.onboardingCompletedAt": new Date().toISOString(),
                "farmNation.termsAcceptedAt": new Date().toISOString(),
                roles: FieldValue.arrayUnion(...roles),
                "serviceRegistrations.farmNation.status": "pending",
                "serviceRegistrations.farmNation.applicationId": appRef.id,
                "serviceRegistrations.farmNation.paymentStatus": "completed",
                "serviceRegistrations.farmNation.role": validatedData.role,
                "serviceRegistrations.farmNation.completedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.farmNation.submittedAt": FieldValue.serverTimestamp(),
                firstName: validatedData.profile.firstName,
                lastName: validatedData.profile.lastName,
                otherName: validatedData.profile.otherName || null,
                fullName,
                phone: validatedData.profile.phone,
                stateOfOrigin: validatedData.profile.state,
                lga: validatedData.profile.lga,
                residentialAddress: validatedData.profile.address,
                /*
                 *   #865 THE IDENTITY NUMBERS, WHERE THE PLATFORM ALREADY KEEPS
                 *   THEM.
                 *
                 *   HASHED, NOT PLAIN, and that is the whole reason this block
                 *   is here rather than left to the `farmNation.profile` spread
                 *   above. The spread stores whatever the form sent, so on its
                 *   own it would have put a raw NIN and BVN at rest in a nested
                 *   profile object — a new plaintext copy of the two numbers
                 *   the platform is most careful with, introduced by a feature
                 *   that was only asked to collect them.
                 *
                 *   The settled convention is kyc-identity-store's: the field's
                 *   own name holds the HASH, which is what duplicate scans
                 *   compare, and `kycReadableField` puts an ENCRYPTED copy
                 *   beside it for a reviewer who needs to see the number. WAVE's
                 *   application writes exactly this; copying its shape rather
                 *   than inventing a third is the point.
                 *
                 *   `ninVerified` / `bvnVerified` are deliberately NOT written.
                 *   Nothing has verified anything — that is what "pass without
                 *   QoreID" means — and the method says so instead, so an admin
                 *   screen renders "Self-declared" rather than a green tick an
                 *   operator would act on (#485).
                 */
                bvn: applicantBvn ? hashData(applicantBvn) : null,
                nin: applicantNin ? hashData(applicantNin) : null,
                "kyc.bvn": applicantBvn ? hashData(applicantBvn) : null,
                "kyc.nin": applicantNin ? hashData(applicantNin) : null,
                ...kycReadableField('bvn', applicantBvn),
                ...kycReadableField('nin', applicantNin),
                "kyc.bvnStatus": "self_declared",
                "kyc.ninStatus": "self_declared",
                "kyc.bvnVerificationMethod": "self_declared",
                "kyc.ninVerificationMethod": "self_declared",
                bvnVerificationMethod: "self_declared",
                ninVerificationMethod: "self_declared",
                updatedAt: FieldValue.serverTimestamp() 
            }));

            // Create authoritative record
            transaction.set(appRef, { 
                userId,
                applicationId: appRef.id,
                userEmail: session.user.email,
                role: validatedData.role,
                profile: storableProfile(validatedData.profile),
                interests: validatedData.interests,
                status: "pending",
                submittedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() 
            });
        });

        try { 
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (err) { 
            logger.error("Failed to invalidate cache after Farm Nation onboarding:", err);
        }

        return { error: null, success: true as const, meta: null, data: null };
    } catch (error: any) { 
        logger.error("Error submitting Farm Nation onboarding:", error);
        return { success: false as const, error: "An error occurred while processing your onboarding. Please try again.", data: null, meta: null };
    }
}


export async function submitFarmNationOnboardingAction(...args: Parameters<typeof _submitFarmNationOnboardingAction>) {
    return withFlexibleSafeAction("submitFarmNationOnboardingAction", _submitFarmNationOnboardingAction)(...args);
}


// ============================================
// Check Farm Nation Application Status Action
// ============================================

async function _checkFarmNationStatusAction(): Promise<ActionResponse<string | null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        //   THROUGH THE REQUEST MEMO, as WAVE's copy of this check already is.
        //   Whatever else in the same request wants this row — the app shell,
        //   a gate, the sidebar's live-roles read — reads it once between them.
        const userDoc = await readUserDocOnce(session.user.id);
        const userData = userDoc.data;

        let status = userData?.serviceRegistrations?.farmNation?.status;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for Farm Nation applications.
        if (status !== "approved") { 
            let appDoc: any = null;
            let appSnap;
            /*
             *   THE FORWARD HALF OF THIS RESOLUTION IS THE ROW ABOVE.
             *
             *   `ownedProfileIdsFor` is `liveProfileId` composed with
             *   `ownedProfileIds`, and its own header says the forward walk
             *   costs "ONE EXTRA KEYED READ ... a live id resolves to itself on
             *   the first hop". That hop reads `users/<id>` — which is
             *   `userData`, read four lines above.
             *
             *   Measured with #261's read meter: a member with no application
             *   cost SIX reads on /farm-nation/onboarding, and this was the
             *   second of them.
             *
             *   THE WALK IS KEPT FOR THE ROW THAT NEEDS IT, exactly as in
             *   checkModuleAccess and _mp_onboarding: a session minted before
             *   an admin settled a duplicate carries an id that has since been
             *   superseded, and that member's application is filed under the id
             *   that lost.
             *
             *   HOISTED OUT OF THE try, because the catch below re-ran the
             *   identical call. Both arms want the same answer and the second
             *   one is not a different question.
             */
            const ownedIds = isLiveUserRow(session.user.id, userData ?? null)
                ? await ownedProfileIds(session.user.id)
                : await ownedProfileIdsFor(session.user.id);
            try {
                appSnap = await filterByOwner(
                    db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS), "userId", ownedIds)
                    .get();
            } catch (e: any) {
                if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.includes("index") || e.message?.includes("INDEX")) {
                    logger.warn("Missing index for checkFarmNationStatusAction, falling back to memory sort");
                    appSnap = await filterByOwner(
                        db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS), "userId", ownedIds)
                        .get();
                } else {
                    throw e;
                }
            }

            if (appSnap && !appSnap.empty) {
                //   #505 One of three hand-written copies of this rule in this
                //   file. See the header on the getter below.
                appDoc = latestApplication(appSnap.docs);
            } else {
                const appId = userData?.serviceRegistrations?.farmNation?.applicationId;
                let foundDirect = false;
                if (appId) {
                    const directDoc = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc(appId).get();
                    if (directDoc.exists) {
                        appDoc = directDoc;
                        foundDirect = true;
                        // Self-healing: backfill userId on direct application doc if missing
                        const appData = directDoc.data()!;
                        if (!appData.userId) {
                            await directDoc.ref.update({ userId: session.user.id });
                        }
                    }
                }
                if (!foundDirect && (session.user.email || userData?.email)) {
                    /**
                     * Claiming a legacy application by email — narrowed twice,
                     * the same two ways checkWaveStatus was.
                     *
                     * That fix (#36) landed on WAVE alone. This copy and the one
                     * in export/_ex_onboarding.ts kept both defects, which is
                     * the shape this audit keeps meeting: one control applied on
                     * two doors out of three.
                     *
                     * DEFECT 1: IT MATCHED A FIELD NOBODY AUTHENTICATED AS
                     * When the `userEmail` query came back empty it fell back to
                     * `profile.email`. `userEmail` is written from
                     * `session.user.email` at submission and is the address the
                     * account actually signed in as; `profile.email` is not — the
                     * onboarding schema has no email field at all, so anything
                     * there arrived from an import or an admin edit and carries
                     * no such guarantee.
                     *
                     * DEFECT 2: IT ADOPTED APPLICATIONS THAT ALREADY HAD AN OWNER
                     * The `!appData.userId` test guarded only the backfill WRITE.
                     * The document became `appDoc` either way, so an application
                     * belonging to a different user id was still read — and the
                     * block below promotes an `approved` application's status
                     * onto the caller AND writes it to their user record, which
                     * module-access-check reads. Only an unclaimed application
                     * can be claimed.
                     */
                    const userEmail = (session.user.email || userData?.email || "").toLowerCase().trim();
                    if (userEmail) {
                        const emailQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                            .where("userEmail", "==", userEmail)
                            .limit(5)
                            .get();

                        const unclaimed = emailQuery.docs.find(d => !d.data()?.userId);

                        if (unclaimed) {
                            appDoc = unclaimed;
                            await unclaimed.ref.update({ userId: session.user.id });
                        } else if (!emailQuery.empty) {
                            logger.warn(
                                `[checkFarmNationStatus] ${emailQuery.docs.length} application(s) match ` +
                                `${userEmail} but every one already belongs to another account; none claimed.`
                            );
                        }
                    }
                }
            }

            if (appDoc) {
                const appData = appDoc.data()!;
                if (appData.status === "approved" || appData.status === "approved_admin") {
                    status = "approved";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                        "serviceRegistrations.farmNation.status": "approved",
                        "serviceRegistrations.farmNation.paymentStatus": "completed",
                        "serviceRegistrations.farmNation.syncedAt": FieldValue.serverTimestamp()
                    });
                    //   #692 The member's own status check heals the record; the
                    //   cached profile session-guard serves for 300 seconds has to
                    //   go with it, or the heal is invisible to the person who asked.
                    await invalidateServiceCache(session.user.id, 'farm-nation');
                } else if (appData.status) { 
                    status = appData.status;
                }
            }
        }

        if (status) { 
            return { success: true as const, data: status, error: null };
        }

        // ── FALLBACK: Farm Nation data was stored directly in userData.farmNation ──
        // This was the V1 data structure before serviceRegistrations was introduced.
        const legacyFarmNation = userData?.farmNation;
        if (legacyFarmNation?.role || legacyFarmNation?.onboardingCompletedAt) { 
            const legacyStatus = 'pending'; // V1 data = completed onboarding = pending review

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                {
                    "serviceRegistrations.farmNation.status": legacyStatus,
                    "serviceRegistrations.farmNation.role": legacyFarmNation.role,
                    "serviceRegistrations.farmNation.syncedFromLegacy": true,
                    "serviceRegistrations.farmNation.syncedAt": new Date().toISOString()
                }
            );

            //   #692 As above — a legacy backfill changes exactly the fields
            //   session-guard caches.
            await invalidateServiceCache(session.user.id, 'farm-nation');
            logger.info(`[checkFarmNationStatus] Backfilled legacy farmNation status '${legacyStatus}' for user ${session.user.id}`);
            return { success: true as const, data: legacyStatus, error: null };
        }

        return { success: true as const, data: null, error: null };
    } catch (error) { 
        logger.error("Error checking Farm Nation status:", error);
        return { success: false as const, error: "Failed to check status", data: null };
    }
}


export async function checkFarmNationStatusAction(...args: Parameters<typeof _checkFarmNationStatusAction>) {
    return withFlexibleSafeAction("checkFarmNationStatusAction", _checkFarmNationStatusAction)(...args);
}


// ============================================================================
// USER REVISION FLOW — Farm Nation Onboarding
// ============================================================================

/**
 * Fetch the current user's Farm Nation onboarding data for prefilling the edit form.
 */
/**
 * Fetch the current user's Farm Nation onboarding data for prefilling the edit form.
 */
async function _getFarmNationApplicationAction(): Promise<ActionResponse<any>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userDocRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data();
        let applicationId = userData?.serviceRegistrations?.farmNation?.applicationId;

        let appDoc: any = null;
        let foundByQuery = false;

        if (applicationId) {
            const docSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc(applicationId).get();
            if (docSnap.exists) {
                appDoc = docSnap;
            }
        }

        if (!appDoc) {
            const snap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where('userId', '==', session.user.id)
                .get();

            if (!snap.empty) {
                /**
                 *   #505 THREE HAND-WRITTEN COPIES OF "WHICH APPLICATION IS
                 *        CURRENT", AND THEY DID NOT EVEN AGREE ON MUTATION.
                 *
                 *   The status checker, this getter and the resubmit each
                 *   carried the same eleven-line comparator. The checker copied
                 *   `[...appSnap.docs]` before sorting; the other two called
                 *   `snap.docs.sort(...)`, which reorders the caller's array in
                 *   place — the thing lib/latest-application.ts copies
                 *   specifically to avoid, and says so in its own header.
                 *
                 *   NONE OF THE THREE HAD A TIEBREAK. On equal or unreadable
                 *   dates the comparator returns 0 and the answer comes from
                 *   incidental order — so the status this module REPORTS, the
                 *   application it SHOWS and the row a resubmit WRITES could
                 *   each land on a different one of a member's applications.
                 *   #504 found exactly that pair in the cooperative twin.
                 *
                 *   That is not hypothetical here: #486 built a forensics check
                 *   called "Approval Drift (User Record vs Application)" because
                 *   this module's records already disagree with each other.
                 *
                 *   The shared rule reads `submittedAt ?? createdAt` through
                 *   toMillis — which handles Timestamps, ISO strings AND epoch
                 *   numbers, where the local `.toDate ? … : new Date(…)` ternary
                 *   handles two of the three — then tiebreaks on the decided
                 *   stamps and finally on document id, and warns when nothing is
                 *   readable rather than choosing in silence. Fourth, fifth and
                 *   sixth copies retired.
                 */
                appDoc = latestApplication(snap.docs);
                applicationId = appDoc.id;
                foundByQuery = true;
            }
        }

        const registration = serializeValue(userData?.serviceRegistrations?.farmNation);

        if (!appDoc) { 
            // Fallback to reading legacy profile if no application document exists yet
            const farmNation = serializeValue(userData?.farmNation);
            if (!farmNation && !registration) {
                return { success: false as const, data: null, error: 'No application found', meta: null };
            }
            return { error: null, success: true as const, data: { application: farmNation, registration, rejectionReason: registration?.rejectionReason } };
        }

        const appData = appDoc.data()!;
        const serializedApp = serializeValue(appData);

        // Self-healing: backfill missing links
        const batch = db.batch();
        let needsCommit = false;

        if (foundByQuery || !userData?.serviceRegistrations?.farmNation?.applicationId) {
            batch.update(userDocRef, {
                "serviceRegistrations.farmNation.applicationId": applicationId
            });
            needsCommit = true;
        }

        if (!appData.userId) {
            batch.update(appDoc.ref, {
                userId: session.user.id
            });
            needsCommit = true;
        }

        if (needsCommit) {
            await batch.commit();
        }

        return { error: null, success: true as const, data: { application: serializedApp, registration, rejectionReason: registration?.rejectionReason || serializedApp.rejectionReason } };
    } catch (error) { 
        logger.error('getFarmNationApplicationAction error:', error);
        return { success: false as const, data: null, error: 'Failed to fetch application', meta: null };
    }
}


export async function getFarmNationApplicationAction(...args: Parameters<typeof _getFarmNationApplicationAction>) {
    return withFlexibleSafeAction("getFarmNationApplicationAction", _getFarmNationApplicationAction)(...args);
}


/**
 * Resubmit a rejected Farm Nation onboarding application with corrected data.
 */
/**
 * Resubmit a rejected Farm Nation onboarding application with corrected data.
 */
async function _resubmitFarmNationApplicationAction(
    data: FarmNationOnboardingData
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        const validation = farmNationOnboardingSchema.safeParse(data);
        if (!validation.success) {
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", data: null, meta: null };
        }
        const validatedData = validation.data;

        const userDocRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data();
        const existingStatus = userData?.serviceRegistrations?.farmNation?.status;
        const allowedStatuses = ['pending', 'rejected', 'revision_required'];

        if (!allowedStatuses.includes(existingStatus || '')) { 
            return { success: false as const, data: null, error: 'Your application cannot be resubmitted at this time.', meta: null };
        }

        let applicationId = userData?.serviceRegistrations?.farmNation?.applicationId;
        let appRef: any = null;

        if (applicationId) {
            const directDoc = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc(applicationId).get();
            if (directDoc.exists) {
                appRef = directDoc.ref;
            }
        }

        if (!appRef) {
            const snap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where('userId', '==', userId)
                .get();

            if (!snap.empty) {
                //   #505 The same shared rule the getter and the status
                //   checker now ask, so the row a member is SHOWN is the row
                //   their correction is WRITTEN to.
                appRef = latestApplication(snap.docs)!.ref;
                applicationId = appRef.id;
            }
        }

        const fullName = [validatedData.profile.firstName, validatedData.profile.otherName, validatedData.profile.lastName]
            .filter(Boolean).join(" ").trim();

        //   #865 Trimmed once, as on the submit path, so the hash and the
        //   encrypted copy are taken from the same string.
        const resubmitNin = validatedData.profile.nin.trim();
        const resubmitBvn = validatedData.profile.bvn.trim();

        await db.runTransaction(async (transaction) => {
            if (!appRef) {
                // Legacy case: Create a new document in FARM_NATION_APPLICATIONS
                const newAppRef = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc();
                appRef = newAppRef;
                applicationId = newAppRef.id;
                transaction.set(newAppRef, {
                    userId,
                    applicationId: newAppRef.id,
                    userEmail: session.user.email || "",
                    role: validatedData.role,
                    profile: storableProfile(validatedData.profile),
                    interests: validatedData.interests,
                    status: "pending",
                    submittedAt: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                transaction.update(appRef, {
                    role: validatedData.role,
                    profile: storableProfile(validatedData.profile),
                    interests: validatedData.interests,
                    status: "pending",
                    rejectionReason: null,
                    resubmittedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // DISEASE 2 FIX: normalizeUserUpdate mirrors farmNation→farm_nation
            // and phone→phoneNumber so both canonical key variants are always in sync.
            transaction.update(userDocRef, normalizeUserUpdate({ 
                "farmNation.role": validatedData.role,
                "farmNation.profile": {
                    ...storableProfile(validatedData.profile),
                    fullName
                },
                "farmNation.interests": validatedData.interests,
                "farmNation.resubmittedAt": new Date().toISOString(),
                "farmNation.termsAcceptedAt": new Date().toISOString(),
                'serviceRegistrations.farmNation.status': 'pending',
                'serviceRegistrations.farmNation.applicationId': applicationId,
                'serviceRegistrations.farmNation.paymentStatus': 'completed',
                'serviceRegistrations.farmNation.role': validatedData.role,
                'serviceRegistrations.farmNation.rejectionReason': null,
                'serviceRegistrations.farmNation.resubmittedAt': FieldValue.serverTimestamp(),
                // Sync KYC name and profile fields to central user document
                firstName: validatedData.profile.firstName,
                lastName: validatedData.profile.lastName,
                otherName: validatedData.profile.otherName || null,
                fullName,
                phone: validatedData.profile.phone,
                stateOfOrigin: validatedData.profile.state,
                lga: validatedData.profile.lga,
                residentialAddress: validatedData.profile.address,
                /*
                 *   #865 THE RESUBMIT PATH WRITES THEM TOO.
                 *
                 *   This function is a near-copy of the submit path, and a rule
                 *   applied to one of the two is how the numbers would be
                 *   collected from a returning applicant and stored nowhere —
                 *   the form asking again and the record staying empty. Same
                 *   hash-plus-encrypted-copy shape as above.
                 */
                bvn: resubmitBvn ? hashData(resubmitBvn) : null,
                nin: resubmitNin ? hashData(resubmitNin) : null,
                "kyc.bvn": resubmitBvn ? hashData(resubmitBvn) : null,
                "kyc.nin": resubmitNin ? hashData(resubmitNin) : null,
                ...kycReadableField('bvn', resubmitBvn),
                ...kycReadableField('nin', resubmitNin),
                "kyc.bvnStatus": "self_declared",
                "kyc.ninStatus": "self_declared",
                "kyc.bvnVerificationMethod": "self_declared",
                "kyc.ninVerificationMethod": "self_declared",
                bvnVerificationMethod: "self_declared",
                ninVerificationMethod: "self_declared",
                updatedAt: FieldValue.serverTimestamp() 
            }));
        });

        try { 
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (err) { 
            logger.error("Failed to invalidate cache after Farm Nation resubmission:", err);
        }

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error: any) { 
        logger.error('resubmitFarmNationApplicationAction error:', error);
        return { success: false as const, data: null, error: 'Failed to resubmit application', meta: null };
    }
}


export async function resubmitFarmNationApplicationAction(...args: Parameters<typeof _resubmitFarmNationApplicationAction>) {
    return withFlexibleSafeAction("resubmitFarmNationApplicationAction", _resubmitFarmNationApplicationAction)(...args);
}


async function _checkFarmNationAccessAction(): Promise<ActionResponse<boolean>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: "Session expired", data: null };
        }
        const hasAccess = await checkModuleAccess(
            sessionResult.session.user.id,
            sessionResult.session.user.roles || [],
            "farm-nation"
        );
        return { success: true as const, error: null, data: hasAccess };
    } catch (error: any) {
        logger.error("checkFarmNationAccessAction error:", error);
        return { success: false as const, error: error.message ?? "Failed to verify access", data: null };
    }
}


export async function checkFarmNationAccessAction(...args: Parameters<typeof _checkFarmNationAccessAction>) {
    return withFlexibleSafeAction("checkFarmNationAccessAction", _checkFarmNationAccessAction)(...args);
}
