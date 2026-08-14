"use server";

import { requireSession } from "@/lib/session-guard";
import { checkModuleAccess } from "@/lib/module-access-check";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { invalidateUserCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { z } from "zod";
import type { FarmNationOnboardingData } from "@/lib/types/farm-nation-actions";

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

        // Prepare user roles
        const roles: string[] = [];
        if (validatedData.role === "buyer" || validatedData.role === "both") { 
            roles.push("investor");
        }
        if (validatedData.role === "seller" || validatedData.role === "both") { 
            roles.push("farmer");
        }

        // ── EXECUTE ONBOARDING IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const appRef = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc();

            // Prepare names
            const fullName = [validatedData.profile.firstName, validatedData.profile.otherName, validatedData.profile.lastName]
                .filter(Boolean).join(" ").trim();

            // DISEASE 2 FIX: normalizeUserUpdate mirrors farmNation→farm_nation
            // and phone→phoneNumber so both canonical key variants are always in sync.
            transaction.update(userRef, normalizeUserUpdate({ 
                "farmNation.role": validatedData.role,
                "farmNation.profile": {
                    ...validatedData.profile,
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
                updatedAt: FieldValue.serverTimestamp() 
            }));

            // Create authoritative record
            transaction.set(appRef, { 
                userId,
                applicationId: appRef.id,
                userEmail: session.user.email,
                role: validatedData.role,
                profile: validatedData.profile,
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

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        let status = userData?.serviceRegistrations?.farmNation?.status;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for Farm Nation applications.
        if (status !== "approved") { 
            let appDoc: any = null;
            let appSnap;
            try {
                appSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                    .where("userId", "==", session.user.id)
                    .get();
            } catch (e: any) {
                if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.includes("index") || e.message?.includes("INDEX")) {
                    logger.warn("Missing index for checkFarmNationStatusAction, falling back to memory sort");
                    appSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                        .where("userId", "==", session.user.id)
                        .get();
                } else {
                    throw e;
                }
            }

            if (appSnap && !appSnap.empty) {
                const sortedDocs = [...appSnap.docs].sort((a, b) => {
                    const aVal = a.data().submittedAt || a.data().createdAt;
                    const bVal = b.data().submittedAt || b.data().createdAt;
                    const aTime = aVal?.toDate ? aVal.toDate().getTime() : (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toDate ? bVal.toDate().getTime() : (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
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
                    const userEmail = (session.user.email || userData?.email || "").toLowerCase().trim();
                    if (userEmail) {
                        let emailQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                            .where("userEmail", "==", userEmail)
                            .limit(1)
                            .get();
                        if (emailQuery.empty) {
                            emailQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                                .where("profile.email", "==", userEmail)
                                .limit(1)
                                .get();
                        }
                        if (!emailQuery.empty) {
                            appDoc = emailQuery.docs[0];
                            // Self-healing: backfill userId on direct application doc if missing
                            const appData = appDoc.data()!;
                            if (!appData.userId) {
                                await appDoc.ref.update({ userId: session.user.id });
                            }
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
                const sortedDocs = snap.docs.sort((a, b) => {
                    const aVal = a.data().submittedAt || a.data().createdAt;
                    const bVal = b.data().submittedAt || b.data().createdAt;
                    const aTime = aVal?.toDate ? aVal.toDate().getTime() : (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toDate ? bVal.toDate().getTime() : (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
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
                const sortedDocs = snap.docs.sort((a, b) => {
                    const aVal = a.data().submittedAt || a.data().createdAt;
                    const bVal = b.data().submittedAt || b.data().createdAt;
                    const aTime = aVal?.toDate ? aVal.toDate().getTime() : (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toDate ? bVal.toDate().getTime() : (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                appRef = sortedDocs[0].ref;
                applicationId = appRef.id;
            }
        }

        const fullName = [validatedData.profile.firstName, validatedData.profile.otherName, validatedData.profile.lastName]
            .filter(Boolean).join(" ").trim();

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
                    profile: validatedData.profile,
                    interests: validatedData.interests,
                    status: "pending",
                    submittedAt: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                transaction.update(appRef, {
                    role: validatedData.role,
                    profile: validatedData.profile,
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
                    ...validatedData.profile,
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
