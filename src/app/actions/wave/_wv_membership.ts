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
import { checkWaveEligibility } from "@/lib/wave-eligibility";
import { toMillis } from "@/lib/firestore-serialize";
import { isPlatformAdmin } from "@/lib/admin-permissions";

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
                /**
                 * Claiming a legacy application by email — narrowed twice.
                 *
                 * WHAT THIS PATH IS FOR
                 * ---------------------
                 * Applications exist with no `userId` — the self-healing branches
                 * above and in _getWaveApplicationAction are there because of them
                 * — and this lets their owner claim one by signing in with the
                 * matching address. That is legitimate and is kept.
                 *
                 * DEFECT 1: IT MATCHED A FIELD THE APPLICANT TYPES
                 * When the `userEmail` query came back empty it fell back to
                 * `email`, which is the OPTIONAL address on the application form —
                 * spread onto the document from validatedData. Attacker-controlled.
                 * So an applicant could type somebody else's address into that
                 * field and, since the block below promotes an `approved`
                 * application's status onto the caller, hand that person her
                 * approved WAVE enrolment. `userEmail` comes from
                 * `session.user.email` and is the address the account actually
                 * authenticated as.
                 *
                 * DEFECT 2: IT ADOPTED APPLICATIONS THAT ALREADY HAD AN OWNER
                 * The `!appData.userId` test guarded only the backfill WRITE. The
                 * document was assigned to `appDoc` either way, so an application
                 * belonging to a different user id was still read, and its status
                 * still promoted onto the caller. Only an unclaimed application can
                 * be claimed.
                 */
                const userEmail = (session.user.email || userData?.email || "").toLowerCase().trim();
                if (userEmail) {
                    const emailQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                        .where("userEmail", "==", userEmail)
                        .limit(5)
                        .get();

                    const unclaimed = emailQuery.docs.find(d => !d.data()?.userId);

                    if (unclaimed) {
                        appDoc = unclaimed;
                        await unclaimed.ref.update({ userId: session.user.id });
                    } else if (!emailQuery.empty) {
                        logger.warn(
                            `[checkWaveStatus] ${emailQuery.docs.length} application(s) match ` +
                            `${userEmail} but every one already belongs to another account; none claimed.`
                        );
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
                const aTime = toMillis(a.createdAt);
                const bTime = toMillis(b.createdAt);
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
        if (session.user.id !== userId && !isPlatformAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return { error: null, success: true as const, data: null };
        }

        /**
         * The shared rule. This function held one of four hand-written copies —
         * see wave-eligibility.ts for how they differed and which one won.
         */
        const verdict = checkWaveEligibility(userDoc.data());

        if (!verdict.eligible) {
            return {
                error: null,
                success: true as const,
                data: { eligible: false, reason: verdict.reason },
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

        /**
         * The guard reads the APPLICATION as well as the registration.
         *
         * THE HOLE IN THE PREVIOUS VERSION OF THIS GUARD
         * ----------------------------------------------
         * It checked `serviceRegistrations.wave.status` alone — the user document's
         * derived copy. checkWaveStatusAction, two hundred lines above in this same
         * file, goes to the application row and calls it "AUTHORITATIVE" precisely
         * because the two drift.
         *
         * And they drift in the direction that matters here. Both admin verdict
         * paths claim the application FIRST and write the user document after, in a
         * separate call: if that second write fails, the application is rejected
         * and the registration status is untouched. An untouched registration is
         * the empty string, the empty string is not in REVIEW_OWNS, and enrolment
         * then wrote "approved" straight over the rejection — the exact defect the
         * guard was added to close, reachable through the exact drift the function
         * above it exists to work around.
         *
         * Either source saying a review owns this decision is enough.
         */
        const REVIEW_OWNS = ["pending", "under_review", "rejected", "revision_required", "suspended"];

        const registrationStatus = String(userData?.serviceRegistrations?.wave?.status || "");

        let applicationStatus = "";
        const ownApps = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
            .where("userId", "==", session.user.id)
            .limit(25)
            .get();

        if (!ownApps.empty) {
            // Any application in a review-owned state blocks, not just the newest
            // one — picking "the latest" would need a reliable ordering key, and
            // this collection is the one whose sort key turned out not to exist.
            const blocking = ownApps.docs
                .map(d => String(d.data()?.status ?? ""))
                .find(s => REVIEW_OWNS.includes(s));
            if (blocking) applicationStatus = blocking;
        }

        const blockedBy = REVIEW_OWNS.includes(registrationStatus)
            ? registrationStatus
            : applicationStatus;

        if (blockedBy) {
            return {
                success: false as const,
                error: blockedBy === "pending" || blockedBy === "under_review"
                    ? "Your WAVE application is awaiting review."
                    : `Your WAVE application is ${blockedBy.replace(/_/g, " ")}. Enrolling cannot override a review decision.`,
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
