"use server";

import { ActionResponse } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { isAdmin } from "@/lib/role-utils";
import { checkModuleAccess } from "@/lib/module-access-check";

/**
 * Check WAVE application status for current user
 */
async function _checkWaveStatusAction(): Promise<ActionResponse<{ status: string | null }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const registration = userData?.serviceRegistrations?.wave;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for WAVE applications.
        let status = registration?.status;
        if (status !== "approved") {
            let appDoc: any = null;
            const appSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .get();

            if (!appSnap.empty) {
                const sortedDocs = appSnap.docs.sort((a, b) => {
                    const aVal = a.data().applicationDate || a.data().createdAt;
                    const bVal = b.data().applicationDate || b.data().createdAt;
                    const aTime = aVal?.toMillis?.() || aVal?.seconds * 1000 || (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toMillis?.() || bVal?.seconds * 1000 || (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
            } else if (registration?.applicationId) {
                const directDoc = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).doc(registration.applicationId).get();
                if (directDoc.exists) {
                    appDoc = directDoc;
                    // Self-healing: backfill userId on direct application doc if missing
                    const appData = directDoc.data()!;
                    if (!appData.userId) {
                        await directDoc.ref.update({ userId: session.user.id });
                    }
                }
            } else if (session.user.email || userData?.email) {
                const userEmail = (session.user.email || userData?.email || "").toLowerCase().trim();
                if (userEmail) {
                    let emailQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                        .where("userEmail", "==", userEmail)
                        .limit(1)
                        .get();
                    if (emailQuery.empty) {
                        emailQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                            .where("email", "==", userEmail)
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

            if (appDoc) {
                const appData = appDoc.data()!;
                if (appData.status === "approved") {
                    status = "approved";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                        "serviceRegistrations.wave.status": "approved",
                        "serviceRegistrations.wave.syncedAt": new Date().toISOString()
                    });
                } else if (appData.status) {
                    status = appData.status;
                }
            }
        }

        if (status) {
            return { error: null, success: true as const, data: { status } };
        }

        // ── FALLBACK: Legacy Sync ──────
        const legacySnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .get();

        if (!legacySnap.empty) {
            const sortedDocs = legacySnap.docs.map(d => d.data()).sort((a: any, b: any) => {
                const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });
            const legacyData = sortedDocs[0];
            const legacyStatus = legacyData?.status ?? 'pending';

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                {
                    "serviceRegistrations.wave.status": legacyStatus,
                    "serviceRegistrations.wave.syncedFromLegacy": true,
                    "serviceRegistrations.wave.syncedAt": new Date().toISOString()
                }
            );

            logger.info(`[checkWaveStatus] Backfilled legacy wave status '${legacyStatus}' for user ${session.user.id}`);
            return { error: null, success: true as const, data: { status: legacyStatus } };
        }
        return { error: null, success: true as const, data: { status: null } };
    } catch (error) {
        logger.error("Check WAVE status error:", error);
        return { success: false as const, error: "Failed to check status", data: null };
    }
}


export const checkWaveStatusAction = withFlexibleSafeAction("checkWaveStatusAction", _checkWaveStatusAction);


/**
 * Check if user is eligible for WAVE (female only)
 */
async function _checkWaveEligibilityAction(userId: string): Promise<ActionResponse<{ eligible: boolean; reason?: string } | null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // Allow checking own eligibility or admin checking others
        if (session.user.id !== userId && (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return { error: null, success: true as const, data: null };
        }

        const userData = userDoc.data();
        const roles = userData?.roles || [];
        const { isAdmin } = await import("@/lib/admin-permissions");
        const isUserAdmin = isAdmin(roles);

        // Check if the user is an Academy Elite member
        const academyReg = userData?.serviceRegistrations?.academy;
        const isAcademyElite = academyReg?.plan === 'elite' && (academyReg?.status === 'approved' || academyReg?.status === 'active');

        // 🔒 SECURITY: Strict Gender Enforcement for standard users
        // Admins (including module-specific admins) and Academy Elite members are always eligible.
        const existingGender = userData?.gender;
        const hasWaveRole = roles.includes("wave_participant");
        const hasWaveReg = userData?.serviceRegistrations?.wave?.status !== undefined;
        
        // Only explicitly block male users who do not have admin, elite, or pre-existing WAVE status/role.
        const isMale = existingGender?.toLowerCase() === "male";

        const userCreatedAt = userData?.createdAt;
        const CUTOFF_DATE = new Date("2026-06-17T00:00:00.000Z");
        let registeredOnOrAfterCutoff = false;
        if (userCreatedAt) {
            const dateVal = typeof userCreatedAt.toDate === "function" 
                ? userCreatedAt.toDate() 
                : (userCreatedAt.seconds ? new Date(userCreatedAt.seconds * 1000) : new Date(userCreatedAt));
            registeredOnOrAfterCutoff = dateVal >= CUTOFF_DATE;
        }
        const isNewMaleUser = isMale && registeredOnOrAfterCutoff;

        // Block if male AND (new user OR doesn't have pre-existing wave access)
        const isWaveBlocked = isMale && (isNewMaleUser || (!hasWaveRole && !hasWaveReg));
        
        if (isWaveBlocked && !isUserAdmin && !isAcademyElite) {
            return {
                error: null,
                success: true as const,
                data: {
                    eligible: false,
                    reason: "WAVE program is exclusively for women entrepreneurs"
                }
            };
        }

        return { error: null, success: true as const, data: { eligible: true } };
    } catch (error) {
        logger.error("WAVE eligibility check error:", error);
        return { success: false as const, error: "Failed to check eligibility", data: null };
    }
}


export const checkWaveEligibilityAction = withFlexibleSafeAction("checkWaveEligibilityAction", _checkWaveEligibilityAction);


/**
 * Enroll user in WAVE program
 */
async function _enrollInWaveAction(userId: string): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (session.user.id !== userId) {
            return { success: false as const, error: "Cannot enroll on behalf of another user", data: null };
        }

        const eligibility = await checkWaveEligibilityAction(userId);

        if (!eligibility.success || !eligibility.data?.eligible) {
            return { success: false as const, error: eligibility.error || eligibility.data?.reason || "Not eligible", data: null };
        }

        // An admin's decision is not the applicant's to overwrite.
        //
        // This action wrote "serviceRegistrations.wave.status": "approved"
        // unconditionally, for whoever called it about themselves. The review
        // path in _admin.ts reaches that same field through
        // claimStatusTransition, so approving or rejecting an application is
        // claimed once and audited — and then this endpoint wrote straight over
        // the result, with no claim and no reviewer.
        //
        // A rejected applicant could call it and be approved. One in
        // revision_required could skip the revisions. One awaiting review could
        // skip the review. module-access-check.ts scores "approved" as full
        // access, so the outcome was worth having.
        //
        // Enrolment is now what its name says: a way in for someone the admins
        // have not yet ruled on. It has no UI caller, but every export of a
        // "use server" module is a reachable endpoint whether the app calls it
        // or not.
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const existingStatus = String(userData?.serviceRegistrations?.wave?.status || "");

        const REVIEW_OWNS = ["pending", "rejected", "revision_required", "suspended"];
        if (REVIEW_OWNS.includes(existingStatus)) {
            return {
                success: false as const,
                error: existingStatus === "pending"
                    ? "Your WAVE application is awaiting review."
                    : `Your WAVE application is ${existingStatus.replace(/_/g, " ")}. Enrolling cannot override a review decision.`,
                data: null,
            };
        }

        await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(userId).set({
            enrolledAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            active: true
        }, { merge: true });

        const existingApplicationId = userData?.serviceRegistrations?.wave?.applicationId || `WAVE-ENROLL-${Date.now()}`;

        // Ensure user registration is also updated
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            "serviceRegistrations.wave.status": "approved",
            "serviceRegistrations.wave.paymentStatus": "completed",
            "serviceRegistrations.wave.applicationId": existingApplicationId,
            "serviceRegistrations.wave.updatedAt": FieldValue.serverTimestamp()
        });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetType: "wave_enrollment"
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("WAVE enrollment error:", error);
        return { success: false as const, error: "Failed to enroll in WAVE program", data: null };
    }
}


export const enrollInWaveAction = withFlexibleSafeAction("enrollInWaveAction", _enrollInWaveAction);


async function _checkWaveAccessAction(): Promise<ActionResponse<boolean>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: "Session expired", data: null };
        }
        const hasAccess = await checkModuleAccess(
            sessionResult.session.user.id,
            sessionResult.session.user.roles || [],
            "wave"
        );
        return { success: true as const, error: null, data: hasAccess };
    } catch (error) {
        logger.error("checkWaveAccessAction error:", error);
        return { success: false as const, error: "Failed to verify access", data: null };
    }
}


export const checkWaveAccessAction = withFlexibleSafeAction("checkWaveAccessAction", _checkWaveAccessAction);
