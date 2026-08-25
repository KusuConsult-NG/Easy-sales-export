/**
 * Auto-provisioning for cooperative membership.
 *
 * These two lived inside cooperative/_actions.ts as private helpers, and three
 * of its actions call them — initiateCooperativePayment, getMembership and
 * checkCooperativeStatus. Splitting that 2,380-line file by domain would have
 * separated the callers from the helpers.
 *
 * THEY DELIBERATELY DO NOT LIVE IN A "use server" MODULE
 * ------------------------------------------------------
 * Sharing them between the new domain files would have meant exporting them,
 * and every export of a "use server" module is a callable endpoint. Their
 * signatures are (userId, email) and (userId, userData), and what they do is
 * grant a cooperative membership with paymentStatus "completed" — so exporting
 * them would publish "provision a paid membership for an arbitrary user id" as
 * an RPC, gated only by an email the caller would be supplying.
 *
 * A plain module cannot be called from a client. That is the whole reason this
 * file exists rather than a _shared.ts next to the actions.
 *
 * The payment-bypass guard is unchanged: isPaymentBypassAccount(email) is the
 * first line of both, and the caller passes the SESSION's email, never a
 * request field.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { invalidateUserCache } from "@/lib/cache-invalidation";

export async function autoProvisionZereCooperative(userId: string, email: string) {
    if (!isPaymentBypassAccount(email)) return;
    
    try {
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const memberDoc = await memberRef.get();
        
        let needsWrite = false;
        if (!memberDoc.exists) {
            needsWrite = true;
        } else {
            const data = memberDoc.data();
            if (data?.paymentStatus !== "completed" || data?.membershipStatus !== "approved" || !data?.onboardingCompleted) {
                needsWrite = true;
            }
        }
        
        if (needsWrite) {
            logger.info(`[autoProvisionZereCooperative] Auto-provisioning cooperative membership for ${email}`);
            const existingCreatedAt = memberDoc.exists ? memberDoc.data()?.createdAt : undefined;
            await memberRef.set({
                userId,
                firstName: "Zere",
                lastName: "Dogo",
                fullName: "Zere Dogo",
                email,
                phone: "08000000000",
                membershipTier: "Member",
                membershipStatus: "approved",
                status: "approved",
                paymentStatus: "completed",
                onboardingCompleted: true,
                onboardingCompletedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                createdAt: existingCreatedAt ?? FieldValue.serverTimestamp()
            }, { merge: true });
        }
        
        // Also update USER document
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            const serviceRegistrations = userData?.serviceRegistrations || {};
            const coopReg = serviceRegistrations.cooperatives || {};
            const roles = userData?.roles || [];
            
            const needsUserUpdate = coopReg.status !== "approved" || 
                                    coopReg.paymentStatus !== "completed" || 
                                    !roles.includes("cooperative_member");
                                    
            if (needsUserUpdate) {
                logger.info(`[autoProvisionZereCooperative] Auto-updating user roles and registrations for ${email}`);
                const updatedRoles = Array.from(new Set([...roles, "cooperative_member"]));
                await userRef.set({
                    roles: updatedRoles,
                    serviceRegistrations: {
                        cooperative: {
                            status: "approved",
                            paymentStatus: "completed",
                            onboardingCompletedAt: new Date().toISOString()
                        },
                        cooperatives: {
                            status: "approved",
                            paymentStatus: "completed",
                            onboardingCompletedAt: new Date().toISOString()
                        }
                    }
                }, { merge: true });
                
                // Invalidate cache
                await invalidateUserCache(userId);
            }
        }
    } catch (error) {
        logger.error("[autoProvisionZereCooperative] Failed to auto-provision Zere:", error);
    }
}

export async function autoProvisionLegacyCooperative(userId: string, userData: any) {
    // Restrict strictly to legacy onboarded members only to prevent auto-provisioning normal users
    if (!userData?.legacyOnboardedBy) {
        return;
    }
    try {
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const memberDoc = await memberRef.get();
        
        let needsWrite = false;
        if (!memberDoc.exists) {
            needsWrite = true;
        } else {
            const data = memberDoc.data();
            // Do not auto-provision or overwrite if they already completed onboarding
            if (!data?.onboardingCompleted) {
                needsWrite = true;
            }
        }
        
        if (needsWrite) {
            logger.info(`[autoProvisionLegacyCooperative] Auto-provisioning cooperative membership for legacy user ${userData.email}`);
            const resolvedName = (userData.name || userData.fullName || "").trim();
            const nameParts = resolvedName.split(/\s+/);
            const firstName = userData.firstName || nameParts[0] || "Cooperative";
            const lastName = userData.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : "Member");

            /**
             *   #257 RE-PROVISIONING WROTE `createdAt: undefined` OVER AN
             *        EXISTING ROW.
             *
             *        Both functions in this file carried:
             *
             *            createdAt: memberDoc.exists
             *                ? memberDoc.data()?.createdAt
             *                : FieldValue.serverTimestamp()
             *
             *        The ternary exists to PRESERVE the original creation date
             *        on a re-run, which is right. But `?.createdAt` is
             *        `undefined` for a row that exists WITHOUT one — and legacy
             *        rows are exactly that, because the import script and the
             *        older provisioning paths did not all write it. So a re-run
             *        sent `createdAt: undefined` and the membership ended up
             *        with no creation date rather than acquiring one.
             *
             *        `createdAt` is a sort key. This audit has already found 34
             *        "most recent" sorts whose key is 0 for the shape the app
             *        writes (#49); a member row with no createdAt sorts to the
             *        bottom of the admin member list permanently, which is
             *        where a member nobody can find lives.
             *
             *        Preserve what is there, supply what is missing.
             */
            const existingCreatedAt = memberDoc.exists ? memberDoc.data()?.createdAt : undefined;
            
            await memberRef.set({
                userId,
                firstName,
                lastName,
                fullName: resolvedName || `${firstName} ${lastName}`,
                email: userData.email || "",
                phone: userData.phone || "08000000000",
                membershipTier: "Member",
                membershipStatus: "active",
                status: "active",
                paymentStatus: "completed",
                onboardingCompleted: false,
                updatedAt: FieldValue.serverTimestamp(),
                createdAt: existingCreatedAt ?? FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (error) {
        logger.error("[autoProvisionLegacyCooperative] Failed to auto-provision legacy cooperative:", error);
    }
}
