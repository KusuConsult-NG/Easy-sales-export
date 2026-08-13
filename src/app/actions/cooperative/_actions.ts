"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { auth } from "@/lib/auth";
import { getBaseUrl } from "@/lib/server-utils";
import { initializePaystackPayment, nairaToKobo } from "@/lib/paystack-server";
import { requireSession } from "@/lib/session-guard";
import { logAuditAction } from "@/app/actions/audit";
import { invalidateUserCache, invalidateCooperativeCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { COLLECTIONS } from "@/lib/types/firestore";
import { debitJsonbBalance, claimSingleOpenLoanApplication } from "@/lib/wallet-ledger";
import { COOPERATIVE_CONFIG } from "@/lib/constants";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";
import { contributionSchema,
    cooperativeMembershipSchema,
    loanApplicationSchema,
    fixedSavingsSchema,
    type MembershipRegistrationState,
    type LoanApplicationState,
    type FixedSavingsState,
    type WithdrawalActionState } from "@/lib/types/cooperative";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { parseFormData } from "@/lib/form-validation";
import type { CooperativeMembership,
    CooperativeTransaction,
    JoinCooperativeState,
    MakeContributionState,
    GetMembershipState,
    GetTransactionsState } from "@/lib/types/cooperative";
import { serializeDoc, serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { revalidatePath } from "next/cache";
import { calculateRepaymentTerms } from "@/lib/loan-terms";
import { parseCurrencyStringToFloat } from "@/lib/utils";

/**
 * Server Actions for Cooperative Management
 * 
 * Handles cooperative membership, contributions, and transaction history.
 * Works with the existing submitWithdrawalAction for withdrawal requests.
 * 
 * PHASE 2 PRD ADDITIONS:
 * - Membership registration with Paystack integration
 * - Fixed savings management
 * - Loan application and management
 */

async function autoProvisionZereCooperative(userId: string, email: string) {
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
                createdAt: memberDoc.exists ? memberDoc.data()?.createdAt : FieldValue.serverTimestamp()
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

async function autoProvisionLegacyCooperative(userId: string, userData: any) {
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
                createdAt: memberDoc.exists ? memberDoc.data()?.createdAt : FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (error) {
        logger.error("[autoProvisionLegacyCooperative] Failed to auto-provision legacy cooperative:", error);
    }
}


// ============================================
// MEMBERSHIP REGISTRATION (PRD Phase 2)
// =========================================


/**
 * Register a new cooperative member with Paystack payment integration
 */
/**
 * 1. INITIATE PAYMENT (Step 1)
 * Creates a partial membership record and initializes Paystack
 */
async function _initiateCooperativePaymentAction(
    tier: "Member" = "Member"
): Promise<MembershipRegistrationState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;
        
        // Payment bypass — see src/lib/payment-bypass.ts for who and why.
        if (isPaymentBypassAccount(session.user.email)) {
            await autoProvisionZereCooperative(userId, session.user.email);
            return {
                error: null,
                success: true as const,
                meta: null,
                data: { message: "Payment already completed", paymentUrl: null, redirectTo: "/cooperatives/onboarding" } as any
            };
        }
        const registrationFee = COOPERATIVE_CONFIG.registrationFee; // Reduced for low-barrier entry

        // Create or update partial membership record
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

        // Check if already active or paid
        const memberDoc = await runQueryWithRetry(() => memberRef.get());
        if (memberDoc.exists) { const data = memberDoc.data();
            if (data?.membershipStatus === "active") {
                return {
                    error: null,
                    success: true as const,
                    meta: null,
                    data: { message: "You are already an active cooperative member.", paymentUrl: null, redirectTo: "/cooperatives/dashboard" } as any
                };
            }
            if (data?.paymentStatus === "completed") {
                // Payment was completed — guide them to onboarding rather than showing a raw error.
                return {
                    error: null,
                    success: true as const,
                    meta: null,
                    data: { message: "Payment already completed", paymentUrl: null, redirectTo: "/cooperatives/onboarding" } as any
                };
            }
        }

        await runQueryWithRetry(() => memberRef.set({ userId,
            membershipTier: tier,
            registrationFee,
            membershipStatus: "pending",
            // Only set paymentStatus to pending if they haven't already paid
            paymentStatus: memberDoc.exists && memberDoc.data()?.paymentStatus === "completed" ? "completed" : "pending",
            updatedAt: FieldValue.serverTimestamp(),
            // Preserve creation date if exists
            createdAt: memberDoc.exists ? memberDoc.data()?.createdAt : FieldValue.serverTimestamp() }, { merge: true }));

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/cooperatives/payment/callback`;

        // Initialize payment with Paystack
        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email || "",
            nairaToKobo(registrationFee),
            {
                userId,
                membershipId: userId,
                membershipTier: tier,
                type: "cooperative_membership_registration",
                callback_url: callbackUrl
            },
            callbackUrl
        );

        // Save reference
        await runQueryWithRetry(() => memberRef.update({ paymentReference: reference }));

        return { error: null,  success: true as const,
            meta: null
        , data: { message: "Action successful", paymentUrl: authorizationUrl } as any };

    } catch (error) { logger.error("Initiate cooperative payment failed:", {
            tier,
            error: error instanceof Error ? error.message : String(error)
        });
        const errMsg = error instanceof Error ? error.message : String(error);
        const isTransient = errMsg.includes("Premature close") || 
                            errMsg.includes("socket hang up") || 
                            errMsg.includes("ECONNRESET") ||
                            errMsg.includes("Client network socket disconnected") ||
                            errMsg.includes("FetchError") ||
                            errMsg.includes("fetch failed") ||
                            errMsg.includes("Connection closed") ||
                            errMsg.includes("Socket closed") ||
                            errMsg.includes("UNAVAILABLE") ||
                            errMsg.includes("stream terminated") ||
                            errMsg.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : (errMsg && errMsg.length > 2 && !errMsg.includes("[object") ? errMsg : "Failed to initiate payment");
        return { error: userFriendlyMessage, success: false as const, data: null };
    }
}
export const initiateCooperativePaymentAction = withFlexibleSafeAction("initiateCooperativePaymentAction", _initiateCooperativePaymentAction);

/**
 * 2. COMPLETE REGISTRATION (Step 2)
 * Submits profile data after payment is confirmed.
 */
export async function registerCooperativeMemberAction(
    formData: FormData
): Promise<MembershipRegistrationState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in to register", success: false as const, data: null };
        }

        const userId = session.user.id;
        const inviteToken = formData.get("inviteToken") as string | null;
        const expectedVersionStr = formData.get("_version") as string | null;
        const expectedVersion = expectedVersionStr ? parseInt(expectedVersionStr, 10) : undefined;

        // Fetch user doc to check if legacy/paid
        const userDoc = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS).doc(userId).get());
        const userData = userDoc.exists ? userDoc.data() : null;
        const isUserLegacy = userData?.legacyOnboardedBy || userData?.serviceRegistrations?.cooperatives?.paymentStatus === "completed" || userData?.serviceRegistrations?.cooperative?.paymentStatus === "completed";

        // Check for existing partial record with payment
        const existingMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const existingMember = await runQueryWithRetry(() => existingMemberRef.get());
        const memberData = existingMember.data();

        let isLegacyImport = false;
        // DISEASE 6 FIX: The form appends "membershipTier" but this was only reading from
        // the Firestore doc — which doesn't exist yet for new registrations. Read form value first.
        const formTier = (formData.get("membershipTier") as string) || "";
        const membershipTier = (formTier || memberData?.membershipTier || "Member") as "Member";

        if (inviteToken) { if (existingMember.exists && memberData?.onboardingCompleted) {
                 return { error: "You have already completed onboarding.", success: false as const, data: null };
            }
            // Validate the token to allow bypassing payment
            const inviteRes = await validateCooperativeInviteAction(inviteToken);
            if (!inviteRes.success) { return { error: inviteRes.error || "Invalid invitation token", success: false as const, data: null };
            }
            isLegacyImport = true;
        } else { // Legacy check
            if (memberData?.onboardingCompleted && memberData?.paymentStatus === "completed") { return { error: "You have already completed onboarding. Profile updates require admin approval.", success: false as const, data: null };
            }
            isLegacyImport = Boolean(memberData?._importSource) || isUserLegacy;
        }

        // DISEASE 6 FIX: parseFormData validates FormData directly against the Zod
        // schema in one step. Field names are now the single binding point — a rename
        // in the HTML form or the schema will surface as a structured fieldError.
        // Note: membershipTier is read separately above because it requires the
        // PROCESSED_PAYMENTS lookup; we inject it here as a pre-validated value.
        const formDataWithTier = new FormData();
        for (const [k, v] of formData.entries()) formDataWithTier.append(k, v);
        formDataWithTier.set("membershipTier", membershipTier);

        const parsed = parseFormData(cooperativeMembershipSchema, formDataWithTier);
        if (!parsed.success) {
            return { error: parsed.error ?? "Validation failed", success: false as const, data: null };
        }
        const validatedData = parsed.data;

        const bvn = (formData.get("bvn") as string || "").trim();
        const nin = (formData.get("nin") as string || "").trim();
        if (bvn && bvn.length !== 11) {
            return { error: "BVN must be exactly 11 digits", success: false as const, data: null };
        }
        if (nin && nin.length !== 11) {
            return { error: "NIN must be exactly 11 digits", success: false as const, data: null };
        }

        const validIdUrl = (formData.get("validIdUrl") as string || "").trim();
        const passportPhotoUrl = (formData.get("passportPhotoUrl") as string || "").trim();
        if (!validIdUrl) {
            return { error: "A valid ID document upload is required", success: false as const, data: null };
        }
        if (!passportPhotoUrl) {
            return { error: "A passport photo upload is required", success: false as const, data: null };
        }

        // 🔒 DEDUP GUARD: Collection-level phone & email check
        // Catches cross-account duplicates (same phone/email, different account)
        const [coopPhoneExists, coopEmailExists] = await runQueryWithRetry(() => Promise.all([
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("phone", "==", validatedData.phone)
                .limit(1)
                .get(),
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("email", "==", validatedData.email)
                .limit(1)
                .get(),
        ]));

        // Allow only if the match is for the SAME user (edit path)
        const phoneDoc = coopPhoneExists.docs?.[0];
        const emailDoc = coopEmailExists.docs?.[0];

        if (!coopPhoneExists.empty && phoneDoc?.id !== userId) { return { error: "A cooperative member with this phone number already exists.", success: false as const, data: null };
        }
        if (!coopEmailExists.empty && emailDoc?.id !== userId) { return { error: "A cooperative member with this email address already exists.", success: false as const, data: null };
        }

        // Determine if payment is already completed (user paid before or during onboarding)
        const alreadyPaid = 
            memberData?.paymentStatus === "completed" ||
            userData?.serviceRegistrations?.cooperatives?.paymentStatus === "completed" ||
            userData?.serviceRegistrations?.cooperative?.paymentStatus === "completed";

        // Auto-activate when payment is confirmed — no admin approval required.
        // Legacy imports and invite-token members are also auto-approved.
        // Only users who have NOT yet paid remain "pending" (awaiting payment).
        const autoActivate = isLegacyImport || alreadyPaid;
        const resolvedStatus = autoActivate ? "active" : "pending";

        // Update membership record with profile data
        const updatedData = { 
            userId: userId,
            firstName: validatedData.firstName,
            otherName: validatedData.otherName || null,
            lastName: validatedData.lastName,
            fullName: [validatedData.firstName, validatedData.otherName, validatedData.lastName]
                .filter(Boolean).join(" ").trim(),
            dateOfBirth: validatedData.dateOfBirth,
            gender: validatedData.gender,
            email: validatedData.email,
            phone: validatedData.phone,
            stateOfOrigin: validatedData.stateOfOrigin,
            lga: validatedData.lga,
            ward: validatedData.ward,
            residentialAddress: validatedData.residentialAddress,
            occupation: validatedData.occupation,
            nextOfKin: {
                name: validatedData.nextOfKinName,
                phone: validatedData.nextOfKinPhone,
                address: validatedData.nextOfKinAddress },
            documents: { validId: formData.get("validIdUrl") ? {
                    name: formData.get("validIdName") as string,
                    url: formData.get("validIdUrl") as string } : undefined,
                passportPhoto: formData.get("passportPhotoUrl") ? { name: formData.get("passportPhotoName") as string,
                    url: formData.get("passportPhotoUrl") as string } : undefined,
                proofOfAddress: formData.get("proofOfAddressUrl") ? { name: formData.get("proofOfAddressName") as string,
                    url: formData.get("proofOfAddressUrl") as string } : undefined },
            bvn: bvn || null,
            bvnVerified: bvn ? true : false,
            nin: nin || null,
            ninVerified: nin ? true : false,
            state: validatedData.stateOfOrigin,
            membershipStatus: resolvedStatus,
            onboardingCompleted: true,
            updatedAt: FieldValue.serverTimestamp(),
        };

        // If from an invite, mark them as paid and from an invite source
        if (inviteToken) { Object.assign(updatedData, {
                paymentStatus: "completed",
                _importSource: "email_invite",
                createdAt: existingMember.exists ? memberData?.createdAt : FieldValue.serverTimestamp() });
        } else {
            Object.assign(updatedData, {
                paymentStatus: alreadyPaid ? "completed" : "pending",
                createdAt: existingMember.exists ? memberData?.createdAt : FieldValue.serverTimestamp()
            });
        }

        // Save to Firestore using a transaction for atomicity
        await runQueryWithRetry(() => db.runTransaction(async (transaction) => { // Re-read for version check
            const freshMember = await transaction.get(existingMemberRef);
            const freshData = freshMember.data();

            // Optimistic Locking Guard
            if (expectedVersion !== undefined && freshData?._version !== undefined && freshData._version !== expectedVersion) {
                throw new Error("STALE_DATA: Member record was updated by another process.");
            }

            // Calculate next version
            const nextVersion = (freshData?._version || 0) + 1;
            (updatedData as any)._version = nextVersion;

            // 1. Save/Merge Member Data
            transaction.set(existingMemberRef, updatedData, { merge: true });

            // 2. If an invite token was used, mark it as completed
            if (inviteToken) { transaction.update(db.collection(COLLECTIONS.COOPERATIVES_INVITES).doc(inviteToken), {
                    status: "used",
                    usedBy: userId,
                    usedAt: FieldValue.serverTimestamp()
                });
            }

            // 3. Update user service registration and sync profile data
            transaction.update(db.collection(COLLECTIONS.USERS).doc(userId), normalizeUserUpdate({ 
                "serviceRegistrations.cooperatives.status": resolvedStatus,
                "serviceRegistrations.cooperatives.membershipTier": validatedData.membershipTier,
                "serviceRegistrations.cooperatives.onboardingCompletedAt": FieldValue.serverTimestamp(),
                // Auto-grant role immediately when payment is confirmed
                ...(autoActivate ? {
                    roles: FieldValue.arrayUnion("cooperative_member"),
                    isVerified: true,
                    "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
                } : {}),

                // Sync KYC name fields for Admin Communication Hub & admin portal
                firstName: validatedData.firstName,
                lastName: validatedData.lastName,
                otherName: validatedData.otherName || null,
                fullName: [validatedData.firstName, validatedData.otherName, validatedData.lastName]
                    .filter(Boolean).join(" ").trim(),

                // Sync other PII for cross-module functionality
                phone: validatedData.phone,
                gender: validatedData.gender,
                stateOfOrigin: validatedData.stateOfOrigin,
                lga: validatedData.lga,
                ward: validatedData.ward,
                residentialAddress: validatedData.residentialAddress,
                "address.state": validatedData.stateOfOrigin,
                "address.lga": validatedData.lga,
                "address.ward": validatedData.ward,
                "address.street": validatedData.residentialAddress,

                // Sync onboarding specific details for admin users modal
                bvn: updatedData.bvn || null,
                bvnVerified: updatedData.bvnVerified,
                nin: updatedData.nin || null,
                ninVerified: updatedData.ninVerified,
                nextOfKin: updatedData.nextOfKin || null,

                updatedAt: FieldValue.serverTimestamp() }));
        }));

        // 5. Post-Commit Side Effects (Secondary Integrations)
        if (inviteToken) {
            // Log as side-effect so it doesn't block the primary transaction
            logAuditAction("legacy_member_invited", userId, "cooperative_member", {
                 details: `Legacy member completed onboarding via invite token: ${inviteToken}`
            }).catch(err => logger.error("Deferred audit log failed:", err));
        }

        try { await invalidateUserCache(userId);
        } catch (err) { logger.error("Failed to invalidate cache after Cooperative application:", err);
        }

        return { error: null, success: true as const,
            meta: null
        , data: { message: "Action successful", version: (updatedData as any)._version } };
    } catch (error) { logger.error("Membership registration failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        const errMsg = error instanceof Error ? error.message : String(error);
        const isTransient = errMsg.includes("Premature close") || 
                            errMsg.includes("socket hang up") || 
                            errMsg.includes("ECONNRESET") ||
                            errMsg.includes("Client network socket disconnected") ||
                            errMsg.includes("FetchError") ||
                            errMsg.includes("fetch failed") ||
                            errMsg.includes("Connection closed") ||
                            errMsg.includes("Socket closed") ||
                            errMsg.includes("UNAVAILABLE") ||
                            errMsg.includes("stream terminated") ||
                            errMsg.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : errMsg;
        return { error: userFriendlyMessage, success: false as const, data: null };
    }
}

// ============================================
// EXISTING ACTIONS (from original file)
// ============================================

export async function joinCooperativeAction(
    cooperativeId: string,
    initialContribution: number = 0
): Promise<JoinCooperativeState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in to join a cooperative", success: false as const, data: null };
        }

        const userId = session.user.id;

        // Check if cooperative exists
        const cooperativeRef = db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId);
        const cooperativeDoc = await cooperativeRef.get();

        if (!cooperativeDoc.exists) { return { error: "Cooperative not found", success: false as const, data: null };
        }

        // Check if user is already a member
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const existingMembership = await membershipsRef
            .where("userId", "==", userId)
            .where("cooperativeId", "==", cooperativeId)
            .get();

        if (!existingMembership.empty) { return { error: "You are already a member of this cooperative", success: false as const, data: null };
        }

        // Atomic batch: all 3-4 writes committed together so no partial state on crash.
        const batch = db.batch();

        const newMemberRef = membershipsRef.doc();
        batch.set(newMemberRef, { userId,
            cooperativeId,
            savingsBalance: initialContribution,
            loanBalance: 0,
            memberSince: FieldValue.serverTimestamp(),
            monthlyTarget: 50000,
            status: "active"
        });

        const cooperativeUpdateData: Record<string, FieldValue | number> = { memberCount: FieldValue.increment(1)
        };

        if (initialContribution > 0) { const txRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();
            batch.set(txRef, {
                userId,
                cooperativeId,
                type: "contribution",
                amount: initialContribution,
                date: FieldValue.serverTimestamp(),
                status: "completed",
                description: "Initial contribution upon joining"
            });

            // Universal ledger sync
            batch.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(txRef.id), { id: txRef.id,
                userId,
                type: "contribution",
                module: "cooperative",
                amount: initialContribution,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: txRef.id,
                description: "Initial contribution upon joining"
            });

            cooperativeUpdateData.totalSavings = FieldValue.increment(initialContribution);
        }

        batch.update(cooperativeRef, cooperativeUpdateData);
        await batch.commit();

        revalidatePath("/cooperatives");
        revalidatePath("/dashboard/cooperatives");
        revalidatePath("/cooperatives/dashboard");

        return { error: null, success: true as const,
            meta: null
        , data: { message: "Action successful" } };
    } catch (error) { logger.error("Join cooperative failed:", {
            cooperativeId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to join cooperative", success: false as const, data: null };
    }
}

async function _makeContributionAction(
    prevState: MakeContributionState,
    formData: FormData
): Promise<MakeContributionState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in to make a contribution", success: false as const, data: null };
        }

        const userId = session.user.id;

        // Strip currency formatting before validating.
        //
        // contributionSchema now coerces, which fixes the string-vs-number
        // rejection that broke every contribution. Coercion alone is not
        // enough for a formatted amount though: Number("₦10,000") is NaN, and
        // the amount field is currency-formatted in the UI. The loan path
        // already did this; this one did not, which would have left a subset of
        // submissions failing after the coercion fix and looked like the bug
        // was only half-fixed.
        const contribAmount = parseCurrencyStringToFloat(formData.get("amount") as string);
        const contribFd = new FormData();
        for (const [k, v] of formData.entries()) contribFd.append(k, v);
        contribFd.set("amount", isNaN(contribAmount) ? "0" : String(contribAmount));

        const parsed = parseFormData(contributionSchema, contribFd);
        if (!parsed.success) {
            return { error: parsed.error ?? "Validation failed", success: false as const, data: null };
        }
        const { cooperativeId, amount, type } = parsed.data;

        if (amount <= 0) { return { error: "Contribution amount must be positive", success: false as const, data: null };
        }

        // Verify membership
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const membershipSnapshot = await membershipsRef
            .where("userId", "==", userId)
            .where("cooperativeId", "==", cooperativeId)
            .get();

        if (membershipSnapshot.empty) { return { error: "You are not a member of this cooperative", success: false as const, data: null };
        }

        const membershipDoc = membershipSnapshot.docs[0];

        // The comment here used to claim this was one atomic commit, and that
        // without it two concurrent contributions would double-count. Neither
        // was true: the adapter queues the writes and flushes them one by one
        // after the callback returns, so there was no isolation and no rollback.
        // The re-read of the membership inside the wrapper was protected by
        // nothing — the query four lines above already returned this document —
        // so it is gone rather than left there looking like a guard.
        //
        // The double-counting it worried about is handled by the primitive, not
        // the wrapper: FieldValue.increment applies the addition in SQL
        // (migration 010), so concurrent contributions cannot lose one another.
        //
        // The balance moves FIRST and the ledger rows are written LAST, so a
        // crash part-way leaves the member credited without a receipt rather
        // than a receipt with no credit.
        const txRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();

        if (type === "savings") {
            await membershipDoc.ref.update({
                savingsBalance: FieldValue.increment(amount)
            });
            await db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId).update({
                totalSavings: FieldValue.increment(amount)
            });
        } else {
            await membershipDoc.ref.update({
                loanBalance: FieldValue.increment(-amount)
            });
        }

        // Ledger rows last — see the ordering note above.
        await txRef.set({
            userId,
            cooperativeId,
            type,
            amount,
            date: FieldValue.serverTimestamp(),
            status: "completed",
            description: type === "savings" ? "Savings contribution" : "Loan repayment"
        });

        // Universal ledger sync
        await db.collection(COLLECTIONS.TRANSACTIONS).doc(txRef.id).set({ id: txRef.id,
            userId,
            type: type,
            module: "cooperative",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference: txRef.id,
            description: type === "savings" ? "Savings contribution" : "Loan repayment"
        });

        revalidatePath("/cooperatives");
        revalidatePath("/dashboard/cooperatives");
        revalidatePath("/cooperatives/dashboard");
        return { error: null, success: true as const, data: { message: "Contribution successful" }, meta: null };
    } catch (error) { logger.error("Contribution failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to make contribution", success: false as const, data: null };
    }
}
export const makeContributionAction = withFlexibleSafeAction("makeContributionAction", _makeContributionAction);

async function _submitWithdrawalAction(
    prevState: WithdrawalActionState,
    formData: FormData
): Promise<WithdrawalActionState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;
        const amount = parseCurrencyStringToFloat(formData.get("amount") as string);
        const reason = formData.get("reason") as string;
        const bankAccountStr = formData.get("bankAccount") as string;
        let bankAccount = null;

        if (isNaN(amount) || amount <= 0) { return { error: "Amount must be greater than zero", success: false as const, data: null };
        }

        try { bankAccount = bankAccountStr ? JSON.parse(bankAccountStr) : null;
        } catch (e) { return { error: "Invalid bank account details", success: false as const, data: null };
        }

        // Membership must be active before any money moves.
        const membershipSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
        if (!membershipSnap.exists || membershipSnap.data()?.membershipStatus !== "active") {
            return { success: false as const, error: "You are not an active cooperative member", data: null };
        }

        // Reserve the funds under a row lock.
        //
        // This read savingsBalance, compared it to the amount, and then
        // decremented — all inside runTransaction, which takes no lock. Two
        // withdrawals submitted at once both read the same balance, both passed
        // the check, and both deducted, taking a member's savings negative.
        //
        // Migration 010 made that worse rather than better: the increments used
        // to lose one another, which accidentally hid the overdraft. Once they
        // apply correctly, both deductions land.
        const debit = await debitJsonbBalance({
            table: "cooperative_members",
            id: userId,
            field: "savingsBalance",
            amount,
        });

        if (!debit.ok) {
            return {
                success: false as const,
                error: debit.reason === "insufficient_funds"
                    ? "Insufficient savings balance"
                    : "You are not an active cooperative member",
                data: null,
            };
        }

        // Move the reserved funds into lockedBalance.
        //
        // The debit above only took the money OUT of savingsBalance. The admin
        // side of this flow assumes it also went somewhere: rejecting a request
        // does `savingsBalance += amount, lockedBalance -= amount`
        // (cooperative/_admin.ts), and approving does `lockedBalance -= amount`.
        // Without this increment the reject restored the savings correctly but
        // drove lockedBalance NEGATIVE by the amount, permanently, on every
        // request submitted through this door.
        //
        // Ordering: after the debit, never before. The debit is the step that
        // can legitimately fail on insufficient funds; incrementing first would
        // lock funds that were never taken.
        await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).update({
            lockedBalance: FieldValue.increment(amount),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // The funds are already reserved by the debit above, which is the only
        // thing here that took a lock. Wrapping the two writes below in
        // runTransaction gave them nothing — the adapter flushes them one by one
        // regardless — so they are written in order: the request row first, then
        // its audit entry.
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc();
        await withdrawalRef.set({ userId,
            amount,
            reason: reason || "Standard Withdrawal",
            bankAccount,
            status: "pending",
            requestedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
        // Log audit
        await logAuditAction(
            "withdrawal_requested",
            withdrawalRef.id,
            "withdrawal",
            { amount, reason }
        );

        revalidatePath("/cooperatives/withdrawals");
        return { error: null,  success: true as const,
            meta: null
        , data: { message: "Action successful" } };
    } catch (error) { logger.error("Withdrawal error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to submit withdrawal", success: false as const, data: null };
    }
}
export const submitWithdrawalAction = withFlexibleSafeAction("submitWithdrawalAction", _submitWithdrawalAction);

async function _getMembershipAction(): Promise<GetMembershipState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { error: sessionResult.error?.error ?? "Authentication required", success: false as const, data: null };
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;
        
        // Fetch user document to check if legacy
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : null;

        // Auto-provision bypass
        if (isPaymentBypassAccount(session.user.email)) {
            await autoProvisionZereCooperative(userId, session.user.email);
        } else if (userData) {
            await autoProvisionLegacyCooperative(userId, userData);
        }

        const snapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .get();

        let doc;
        if (snapshot.empty) {
            // Fallback 1: direct document ID check
            const docRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                // Heal the document by adding the userId field on-the-fly
                const docData = docSnap.data()!;
                if (!docData.userId) {
                    await docRef.update({ userId });
                }
                doc = docSnap;
            } else if (userData?.email) {
                // Fallback 2: query by email
                const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("email", "==", userData.email.toLowerCase())
                    .limit(1)
                    .get();
                if (!emailQuery.empty) {
                    const emailDocRef = emailQuery.docs[0].ref;
                    const emailDocData = emailQuery.docs[0].data();
                    if (!emailDocData.userId) {
                        await emailDocRef.update({ userId });
                    }
                    doc = emailQuery.docs[0];
                } else {
                    return { error: "No membership found", success: false as const, data: null };
                }
            } else {
                return { error: "No membership found", success: false as const, data: null };
            }
        } else {
            doc = snapshot.docs[0];
        }

        const membership = serializeDoc<CooperativeMembership>(doc.id, doc.data());

        return { error: null,  success: true as const, data: { membership } };
    } catch (error) { logger.error("Get membership error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "An unexpected error occurred", success: false as const, data: null };
    }
}
export const getMembershipAction = withFlexibleSafeAction("getMembershipAction", _getMembershipAction);

async function _getTransactionsAction(): Promise<GetTransactionsState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { error: sessionResult.error?.error ?? "Authentication required", success: false as const, data: null };
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where("userId", "==", userId)
            .orderBy("date", "desc")
            .get();

        const transactions = serializeDocs<CooperativeTransaction>(snapshot.docs);

        return { error: null,  success: true as const, data: { transactions } };
    } catch (error) { logger.error("Get transactions error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "An unexpected error occurred", success: false as const, data: null };
    }
}
export const getTransactionsAction = withFlexibleSafeAction("getTransactionsAction", _getTransactionsAction);

async function _getUserTierAction(): Promise<{ success: true; error: null; data: {
        tier: "Member" | null;
        totalContributions: number;
    } }
    | { success: false; error: string; data: null }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { error: "Action failed", success: false as const, data: null };
        const { session } = sessionResult;

        const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
        const membershipDoc = await membershipRef.get();

        if (!membershipDoc.exists) { return { error: null, success: true as const, data: { tier: null, totalContributions: 0 } };
        }

        const data = membershipDoc.data();
        // Check if data exists and has totalContributions, else 0. 
        // Note: data() returns undefined if not exists but we checked exists. 
        // But TS might want optional chaining or explicit cast.
        const totalContributions = data?.totalContributions || 0;

        const { calculateUserTier } = await import("@/lib/cooperative-tiers");
        const tier = calculateUserTier(totalContributions);

        return { error: null, success: true as const, data: { tier, totalContributions } };
    } catch (error) { logger.error("Failed to get user tier:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Action failed", success: false as const, data: null };
    }
}
export const getUserTierAction = withFlexibleSafeAction("getUserTierAction", _getUserTierAction);

// ============================================
// Check Cooperative Application Status Action
// ============================================

async function _checkCooperativeStatusAction(): Promise<string | null> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null;
        const { session } = sessionResult;

        if (isPaymentBypassAccount(session.user.email)) {
            await autoProvisionZereCooperative(session.user.id, session.user.email);
            return "approved";
        }

        // ── PRIMARY: Check central user document for service registration ──
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        // Support both key variants:
        //  - 'cooperatives' (plural) — written by registerCooperativeMemberAction post-V2
        //  - 'cooperative' (singular) — written by the legacy import script
        // We resolve the one that has the more advanced onboarding/membership status.
        const coopReg = userData?.serviceRegistrations?.cooperatives;
        const legacyReg = userData?.serviceRegistrations?.cooperative;

        const getProgressScore = (status: string) => {
            switch (status) {
                case 'active':
                case 'approved':
                    return 4;
                case 'pending':
                case 'pending_review':
                case 'revision_required':
                    return 3;
                case 'pending_repair':
                case 'legacy_pending_onboarding':
                    return 2;
                case 'not_started':
                    return 1;
                default:
                    return 0;
            }
        };

        let registration = coopReg || legacyReg;
        if (coopReg && legacyReg) {
            const scorePlural = getProgressScore(coopReg.status || '');
            const scoreSingular = getProgressScore(legacyReg.status || '');
            if (scoreSingular > scorePlural) {
                registration = legacyReg;
            }
        }

        let registrationStatus = registration?.status;
        if (registrationStatus === 'active' || registrationStatus === 'approved') {
            return 'approved';
        }

        // ── FALLBACK: cooperative_members doc query by userId or docId ─────────
        let memberDocData: any = null;
        let memberRef: any = null;
        
        const memberSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .doc(session.user.id)
            .get();

        if (memberSnap.exists) {
            memberDocData = memberSnap.data();
            memberRef = memberSnap.ref;
        } else {
            const memberQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("userId", "==", session.user.id)
                .limit(1)
                .get();
            if (!memberQuery.empty) {
                memberDocData = memberQuery.docs[0].data();
                memberRef = memberQuery.docs[0].ref;
            } else if (session.user.email) {
                const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("email", "==", session.user.email.toLowerCase())
                    .limit(1)
                    .get();
                if (!emailQuery.empty) {
                    memberDocData = emailQuery.docs[0].data();
                    memberRef = emailQuery.docs[0].ref;
                }
            }
        }

        if (memberDocData) {
            const derivedStatus = memberDocData.membershipStatus ?? memberDocData.status ?? 'pending';

            // Compare progress scores between user doc registration and member doc derivedStatus
            const scoreUser = getProgressScore(registrationStatus || '');
            const scoreMember = getProgressScore(derivedStatus);

            // Heal the membership document with the userId if missing
            if (!memberDocData.userId && memberRef) {
                await memberRef.update({ userId: session.user.id });
                logger.info(`[checkCooperativeStatus] Healed membership ${memberRef.id} with userId ${session.user.id}`);
            }

            // Sync user doc status from member doc if member doc has a more progressed status,
            // or if the user doc status was missing, or if we need to sync roles.
            const needsUserDocHeal = scoreMember > scoreUser || 
                !registrationStatus || 
                ((derivedStatus === 'active' || derivedStatus === 'approved') && !userData?.roles?.includes('cooperative_member'));

            if (needsUserDocHeal) {
                // Backfill the user doc so future reads hit the fast path
                await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                    normalizeUserUpdate({ 
                        "serviceRegistrations.cooperatives.status": derivedStatus, 
                        "serviceRegistrations.cooperatives.syncedFromLegacy": true, 
                        "serviceRegistrations.cooperatives.syncedAt": new Date().toISOString(),
                        ...(derivedStatus === 'active' || derivedStatus === 'approved' ? {
                            roles: FieldValue.arrayUnion("cooperative_member")
                        } : {})
                    })
                );
                logger.info(`[checkCooperativeStatus] Healed user ${session.user.id} status to '${derivedStatus}' from membership`);
                registrationStatus = derivedStatus;
            }

            // Legacy import members: paymentStatus=completed but onboardingCompleted=false
            if (memberDocData.paymentStatus === 'completed' && !memberDocData.onboardingCompleted) {
                return 'legacy_pending_onboarding';
            }
            const isLegacy = memberDocData.isLegacy === true || !!userData?.legacyOnboardedBy;
            const isApprovedOrActive = derivedStatus === 'active' || derivedStatus === 'approved';

            // If the user has submitted the form (onboardingCompleted=true)
            // but has NOT completed the payment yet, return payment_required.
            if (memberDocData.onboardingCompleted && 
                memberDocData.paymentStatus !== 'completed' && 
                !isLegacy && 
                !isApprovedOrActive && 
                !isPaymentBypassAccount(session.user.email)
            ) {
                return 'payment_required';
            }

            // Only block with 'pending_review' if the member genuinely hasn't paid yet.
            // If they have a completed payment but status is somehow still 'pending' (race
            // condition between form submit and webhook), auto-heal them to 'active' here.
            if (memberDocData.onboardingCompleted && (derivedStatus === 'pending' || derivedStatus === 'under_review')) {
                if (memberDocData.paymentStatus === 'completed') {
                    // Payment confirmed — heal immediately, no admin needed
                    await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberRef.id).update({
                        membershipStatus: 'active',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                        normalizeUserUpdate({
                            'serviceRegistrations.cooperatives.status': 'active',
                            'serviceRegistrations.cooperatives.activatedAt': FieldValue.serverTimestamp(),
                            roles: FieldValue.arrayUnion('cooperative_member'),
                            isVerified: true,
                            updatedAt: FieldValue.serverTimestamp(),
                        })
                    );
                    return 'active';
                }
                return 'pending_review';
            }

            return derivedStatus;
        }

        // ── FINAL AUTHORITATIVE CHECK: Paystack Records ─────────────────
        // If no profile status was found above, check the source of truth for payments.
        // This handles cases where a user just paid but the background sync hasn't
        // finished updating the member/user documents.
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("userId", "==", session.user.id)
            .where("type", "==", "cooperative_membership_registration")
            .where("status", "==", "completed")
            .limit(1)
            .get();

        if (!paymentsSnap.empty) {
            logger.info(`[checkCooperativeStatus] Auth-Paid status detected for user ${session.user.id}`);
            return "legacy_pending_onboarding"; // Allow them to proceed to fill the form
        }

        return registrationStatus || null;
    } catch (error) { logger.error("Error checking cooperative status:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}
export const checkCooperativeStatusAction = withFlexibleSafeAction("checkCooperativeStatusAction", _checkCooperativeStatusAction);

// ============================================
// LOAN MANAGEMENT (PRD Phase 2)
// ============================================

async function _applyForLoanAction(
    prevState: LoanApplicationState,
    formData: FormData
): Promise<LoanApplicationState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in to apply for a loan", success: false as const, data: null };
        }

        const userId = session.user.id;

        // DISEASE 6 FIX: parseFormData binding
        const amountNum = parseCurrencyStringToFloat(formData.get("amount") as string);
        const loanFd = new FormData();
        for (const [k, v] of formData.entries()) loanFd.append(k, v);
        loanFd.set("amount", isNaN(amountNum) ? "0" : String(amountNum));

        const parsed = parseFormData(loanApplicationSchema, loanFd);
        if (!parsed.success) {
            return { error: parsed.error ?? "Validation failed", success: false as const, data: null };
        }
        const { productId, amount, purpose } = parsed.data;

        // The double-lending guard is now the insert itself — see the claim at
        // the end of this function.
        //
        // It used to be a pair of reads here: query both loan collections for
        // open applications and refuse if either was non-empty. Those reads took
        // no lock (originally inside runTransaction, which does not provide one),
        // so two applications submitted together both saw an empty result and
        // both created a pending row.
        //
        // A row lock could not fix it, because the thing being guarded is the
        // ABSENCE of rows — there is nothing to lock. Migration 021 does the
        // check and the insert under a per-borrower advisory lock instead.
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const membershipSnapshot = await membershipsRef.where("userId", "==", userId).get();

        if (membershipSnapshot.empty) {
            throw new Error("You must be a cooperative member to apply for a loan");
        }

        const membershipDoc = membershipSnapshot.docs[0];
        const membershipData = membershipDoc.data();

        const loansRef = db.collection(COLLECTIONS.COOPERATIVE_LOANS);

        // 2. Check Loan Limit (e.g., 3x Savings Balance)
        const savingsBalance = membershipData.savingsBalance || 0;
        const maxLoanAmount = savingsBalance * 3;

        if (amount > maxLoanAmount) {
            throw new Error(`Loan amount exceeds your limit of ₦${maxLoanAmount.toLocaleString()} (3x Savings)`);
        }

        // 3. The loan is written on the terms of the product the member chose.
        //
        // This read COLLECTIONS.COOPERATIVE_LOAN_PRODUCTS — "cooperative_loan_products",
        // a collection NOTHING WRITES. Every loan product the admin creates goes
        // into COLLECTIONS.LOAN_PRODUCTS ("loan_products"), which is what the
        // admin CRUD routes, the public list and /api/cooperative/apply-loan all
        // use. The only reference to the other name anywhere is its definition.
        //
        // So productDoc.exists was always false and every application fell
        // through to the defaults below it:
        //
        //     let interestRate = 5; // Default 5%
        //     let durationMonths = 6;
        //
        // The member page fetches products from /api/cooperative/loan-products,
        // shows the real rate, and quotes with calculateRepaymentTerms. Then it
        // submits here. So the borrower was quoted their product's terms and the
        // loan was recorded at 5% over 6 months, whichever product they picked.
        //
        // The interest maths differed too. This computed `amount * (rate/100)`
        // once — a flat charge — while the route and the quote treat
        // interestRate as a MONTHLY rate through calculateRepaymentTerms, which
        // cooperative-tiers.ts and loan-terms.ts both say is correct. Same
        // function now, so a rate change or a fix cannot reach only one of them.
        //
        // Fails closed on a missing or malformed product, as the route does. A
        // silent default is what turned this into money.
        const productDoc = await db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId).get();
        if (!productDoc.exists) {
            throw new Error("That loan product is no longer available.");
        }

        const prod = productDoc.data()!;
        const interestRate = Number(prod.interestRate);
        const durationMonths = Number(prod.durationMonths);

        if (!Number.isFinite(interestRate) || interestRate < 0
            || !Number.isInteger(durationMonths) || durationMonths < 1) {
            logger.error("[Loan Apply] Loan product has unusable terms", {
                productId,
                interestRate: prod.interestRate,
                durationMonths: prod.durationMonths,
            });
            throw new Error("That loan product is not correctly configured. Please contact support.");
        }

        const terms = calculateRepaymentTerms(amount, durationMonths, interestRate);
        const interestAmount = terms.totalRepayment - amount;
        const totalRepayment = terms.totalRepayment;
        const monthlyPayment = terms.monthlyPayment;

        // Create the loan application, and let the insert be the guard.
        //
        // The claim refuses if the borrower has an open application in EITHER
        // collection, checked under a per-borrower advisory lock held across
        // the check and the insert. Two applications submitted together now
        // serialise: the second sees the first one's row and is refused.
        //
        // Timestamps are literal here rather than FieldValue.serverTimestamp():
        // the row is passed to Postgres as JSONB and sentinels are not resolved,
        // the same caveat claim_status_transition carries. created_at/updated_at
        // are set by the function itself.
        const newLoanRef = loansRef.doc();
        const nowIso = new Date().toISOString();

        const claim = await claimSingleOpenLoanApplication({
            userId,
            id: newLoanRef.id,
            table: "cooperative_loans",
            row: {
                memberId: userId,
                productId,
                amount,
                purpose,
                interestAmount,
                totalRepayment,
                monthlyPayment,
                durationMonths,
                status: "pending",
                appliedAt: nowIso,
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        });

        if (!claim.claimed) {
            throw new Error("Active or pending loan application already exists platform-wide.");
        }

        try {
            await invalidateCooperativeCache(userId);
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Loan Apply Cache] Cache clear error:', cacheError);
        }

        return { error: null, success: true as const,
            meta: null
        , data: { message: "Action successful" } };

    } catch (error) { logger.error("Loan application failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to submit loan application", success: false as const, data: null };
    }
}
export const applyForLoanAction = withFlexibleSafeAction("applyForLoanAction", _applyForLoanAction);

// ============================================
// FIXED SAVINGS (PRD Phase 2)
// ============================================

async function _createFixedSavingsAction(
    prevState: FixedSavingsState,
    formData: FormData
): Promise<FixedSavingsState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;

        const rawData = { amount: parseCurrencyStringToFloat(formData.get("amount") as string),
            durationMonths: Number(formData.get("durationMonths")) };

        const validationResult = fixedSavingsSchema.safeParse(rawData);
        if (!validationResult.success) { return { error: validationResult.error.issues[0]?.message || "Invalid input", success: false as const, data: null };
        }

        const { amount, durationMonths } = validationResult.data;

        if (amount <= 0) { return { error: "Amount must be positive", success: false as const, data: null };
        }

        const membershipSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .limit(1)
            .get();

        if (membershipSnapshot.empty) {
            return { success: false as const, error: "Membership not found", data: null };
        }

        const membershipId = membershipSnapshot.docs[0].id;

        // Lock the savings before creating the plan.
        //
        // Same read-check-write as the withdrawal path: two plans created at
        // once both read the same savings balance, both passed the sufficiency
        // check, and both deducted — locking away more than the member had.
        const debit = await debitJsonbBalance({
            table: "cooperative_members",
            id: membershipId,
            field: "savingsBalance",
            amount,
        });

        if (!debit.ok) {
            return {
                success: false as const,
                error: debit.reason === "insufficient_funds"
                    ? "Insufficient savings balance to create this fixed savings plan"
                    : "Membership not found",
                data: null,
            };
        }

        // Create Fixed Savings Record. This is a single write; the
        // runTransaction wrapper around it bought nothing at all.
        const fixedSavingsRef = db.collection(COLLECTIONS.COOPERATIVE_FIXED_SAVINGS).doc();
        await fixedSavingsRef.set({ memberId: userId,
            amount,
            durationMonths,
            startDate: FieldValue.serverTimestamp(),
            status: "active",
            interestRate: 14, // 14% p.a.
            createdAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const, data: { message: "Fixed savings plan created" }  };
    } catch (error) { logger.error("Fixed savings creation failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to create fixed savings plan", success: false as const, data: null };
    }
}
export const createFixedSavingsAction = withFlexibleSafeAction("createFixedSavingsAction", _createFixedSavingsAction);

// ============================================
// WITHDRAWALS
// ============================================

// End of withdrawal management
// DIRECTORY
// ============================================

async function _getDirectoryMembersAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        // Allow any logged in user? Or just admin? Assuming members can view directory.
        if (!session?.user) { return { error: "Unauthorized", success: false as const, data: null };
        }

        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        // Query both "active" (canonical since May 2026) and "approved" (legacy status) — both are fully approved members.
        const snapshot = await membershipsRef.where("membershipStatus", "in", ["approved", "active"]).get();

        const members = snapshot.docs
            .map((doc: any) => {
                const data = doc.data();
                // Real-time corruption check
                const isCorrupted = !data.firstName || 
                                   !data.lastName || 
                                   data.firstName === "undefined" || 
                                   data.lastName === "undefined";
                if (isCorrupted) return null;

                return {
                    id: doc.id,
                    name: `${data.firstName} ${data.lastName}`,
                    role: "Member",
                    location: `${data.lga}, ${data.stateOfOrigin}`,
                    occupation: data.occupation,
                    joined: data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : "Recent",
                    image: data.documents?.passportPhoto?.url || null,
                    phone: data.phone || ""
                };
            })
            .filter(Boolean); // Remove nulls (corrupted)

        return { error: null, success: true as const, data: members, meta: null };

    } catch (error) { logger.error("Failed to fetch directory:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Failed to load directory", success: false as const, data: null };
    }
}
export const getDirectoryMembersAction = withFlexibleSafeAction("getDirectoryMembersAction", _getDirectoryMembersAction);

// ============================================================================
// REVISION FLOW — Fetch existing application data & resubmit
// ============================================================================

/**
 * Get the current user's existing cooperative onboarding data (for pre-populating edit form)
 */
export async function getCooperativeApplicationAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized'};

        // Find the member doc by userId
        let snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where('userId', '==', session.user.id)
            .get();

        if (snap.empty) {
            // Fallback to direct document ID check
            const docRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                // Heal the document by adding the userId field on-the-fly
                const docData = docSnap.data()!;
                if (!docData.userId) {
                    await docRef.update({ userId: session.user.id });
                }
                snap = { empty: false, docs: [docSnap] } as any;
            } else if (session.user.email) {
                // Fallback to email query
                const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("email", "==", session.user.email.toLowerCase())
                    .limit(1)
                    .get();
                if (!emailQuery.empty) {
                    const memberDoc = emailQuery.docs[0];
                    if (!memberDoc.data().userId) {
                        await memberDoc.ref.update({ userId: session.user.id });
                    }
                    snap = { empty: false, docs: [memberDoc] } as any;
                } else {
                    return { success: false as const, error: 'No application found'};
                }
            } else {
                return { success: false as const, error: 'No application found'};
            }
        }

        const sortedDocs = snap.docs.map(d => d.data()).sort((a: any, b: any) => { const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });
        const data = serializeValue(sortedDocs[0]);
        // Wrap data in application key to match frontend expectation (OnboardingClient.tsx result.data?.application)
        return { error: null, success: true as const, data: { application: data, revisionNote: data.revisionNote || null }, meta: null };
    } catch (error) { logger.error('getCooperativeApplicationAction error:', {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: 'Failed to fetch application'};
    }
}

/**
 * Resubmit cooperative application after a revision request
 */
export async function resubmitCooperativeApplicationAction(
    formData: FormData
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized'};

        const userDoc = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS).doc(session.user.id).get());
        const userData = userDoc.data();
        const coopReg = userData?.serviceRegistrations?.cooperatives;
        const legacyReg = userData?.serviceRegistrations?.cooperative;

        const getProgressScore = (status: string) => {
            switch (status) {
                case 'active':
                case 'approved':
                    return 4;
                case 'pending':
                case 'pending_review':
                case 'revision_required':
                    return 3;
                case 'pending_repair':
                case 'legacy_pending_onboarding':
                    return 2;
                case 'not_started':
                    return 1;
                default:
                    return 0;
            }
        };

        let registration = coopReg || legacyReg;
        if (coopReg && legacyReg) {
            const scorePlural = getProgressScore(coopReg.status || '');
            const scoreSingular = getProgressScore(legacyReg.status || '');
            if (scoreSingular > scorePlural) {
                registration = legacyReg;
            }
        }
        const existingStatus = registration?.status;

        // Allow 'pending_repair' so users in repair can submit their fixes
        const allowedStatuses = ['pending', 'revision_required', 'pending_repair'];
        if (!allowedStatuses.includes(existingStatus)) { return { success: false as const, error: 'Your application cannot be resubmitted at this time.'};
        }

        // Find the existing member doc by userId or direct document ID fallback
        const snap = await runQueryWithRetry(() => db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where('userId', '==', session.user.id)
            .get());

        let memberRef;
        let existingMemberData: any = null;
        if (snap.empty) {
            const docRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
            const docSnap = await runQueryWithRetry(() => docRef.get());
            if (docSnap.exists) {
                memberRef = docRef;
                existingMemberData = docSnap.data();
            } else {
                // FALLBACK: If user doc is marked as pending_repair / pending but the member record
                // was deleted during the mock database purge, auto-heal by allowing a new creation.
                logger.info(`[resubmitCooperativeApplication] Member doc not found for user ${session.user.id} — falling back to new registration creation.`);
                memberRef = docRef;
                existingMemberData = {};
            }
        } else {
            const sortedDocs = snap.docs.sort((a, b) => { const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
                const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });
            memberRef = sortedDocs[0].ref;
            existingMemberData = sortedDocs[0].data();
        }

        const formDataWithTier = new FormData();
        for (const [k, v] of formData.entries()) formDataWithTier.append(k, v);
        formDataWithTier.set("membershipTier", "Member");

        const parsed = parseFormData(cooperativeMembershipSchema, formDataWithTier);
        if (!parsed.success) {
            return { success: false as const, error: parsed.error ?? "Validation failed" };
        }
        const validatedData = parsed.data;

        const bvn = (formData.get("bvn") as string || "").trim();
        const nin = (formData.get("nin") as string || "").trim();
        if (bvn && bvn.length !== 11) {
            return { success: false as const, error: "BVN must be exactly 11 digits" };
        }
        if (nin && nin.length !== 11) {
            return { success: false as const, error: "NIN must be exactly 11 digits" };
        }

        const validIdUrl = (formData.get("validIdUrl") as string) || existingMemberData?.documents?.validId?.url || "";
        const passportPhotoUrl = (formData.get("passportPhotoUrl") as string) || existingMemberData?.documents?.passportPhoto?.url || "";
        if (!validIdUrl) {
            return { success: false as const, error: "Valid ID document is required" };
        }
        if (!passportPhotoUrl) {
            return { success: false as const, error: "Passport photo is required" };
        }

        const updatePayload: Record<string, any> = { 
            userId: session.user.id, // Ensure userId is populated
            firstName: validatedData.firstName,
            otherName: validatedData.otherName || null,
            lastName: validatedData.lastName,
            fullName: [validatedData.firstName, validatedData.otherName, validatedData.lastName].filter(Boolean).join(' '),
            dateOfBirth: validatedData.dateOfBirth,
            gender: validatedData.gender,
            email: validatedData.email,
            phone: validatedData.phone,
            occupation: validatedData.occupation,
            stateOfOrigin: validatedData.stateOfOrigin,
            lga: validatedData.lga,
            ward: validatedData.ward,
            residentialAddress: validatedData.residentialAddress,
            nextOfKinName: validatedData.nextOfKinName,
            nextOfKinPhone: validatedData.nextOfKinPhone,
            nextOfKinAddress: validatedData.nextOfKinAddress,
            bvn: bvn || null,
            bvnVerified: bvn ? true : false,
            nin: nin || null,
            ninVerified: nin ? true : false,
            membershipStatus: 'pending',
            revisionNote: null,
            resubmittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() };

        if (formData.get('validIdUrl')) { 
            updatePayload['documents.validId.url'] = formData.get('validIdUrl');
            updatePayload['documents.validId.name'] = formData.get('validIdName') || 'ID Document';
        }
        if (formData.get('passportPhotoUrl')) { 
            updatePayload['documents.passportPhoto.url'] = formData.get('passportPhotoUrl');
            updatePayload['documents.passportPhoto.name'] = formData.get('passportPhotoName') || 'Passport Photo';
        }
        if (formData.get('proofOfAddressUrl')) { 
            updatePayload['documents.proofOfAddress.url'] = formData.get('proofOfAddressUrl');
            updatePayload['documents.proofOfAddress.name'] = formData.get('proofOfAddressName') || 'Proof of Address';
        }

        const batch = db.batch();
        batch.update(memberRef, updatePayload);
        batch.update(db.collection(COLLECTIONS.USERS).doc(session.user.id), { 
            'serviceRegistrations.cooperatives.status': 'pending',
            firstName: validatedData.firstName,
            lastName: validatedData.lastName,
            otherName: validatedData.otherName || null,
            fullName: [validatedData.firstName, validatedData.otherName, validatedData.lastName].filter(Boolean).join(' ').trim(),
            phone: validatedData.phone || null,
            gender: validatedData.gender || null,
            stateOfOrigin: validatedData.stateOfOrigin || null,
            lga: validatedData.lga || null,
            ward: validatedData.ward || null,
            residentialAddress: validatedData.residentialAddress || null,
            'address.state': validatedData.stateOfOrigin || null,
            'address.lga': validatedData.lga || null,
            'address.ward': validatedData.ward || null,
            'address.street': validatedData.residentialAddress || null,
            bvn: bvn || null,
            bvnVerified: bvn ? true : false,
            nin: nin || null,
            ninVerified: nin ? true : false,
            nextOfKin: {
                name: validatedData.nextOfKinName || null,
                phone: validatedData.nextOfKinPhone || null,
                address: validatedData.nextOfKinAddress || null,
            },
            updatedAt: FieldValue.serverTimestamp() 
        });

        await runQueryWithRetry(() => batch.commit());

        try { await invalidateUserCache(session.user.id);
        } catch (err) { logger.error("Failed to invalidate cache after Cooperative application resubmission:", err);
        }

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error) { logger.error('resubmitCooperativeApplicationAction error:', {
            error: error instanceof Error ? error.message : String(error)
        });
        const errMsg = error instanceof Error ? error.message : String(error);
        const isTransient = errMsg.includes("Premature close") || 
                            errMsg.includes("socket hang up") || 
                            errMsg.includes("ECONNRESET") ||
                            errMsg.includes("Client network socket disconnected") ||
                            errMsg.includes("FetchError") ||
                            errMsg.includes("fetch failed") ||
                            errMsg.includes("Connection closed") ||
                            errMsg.includes("Socket closed") ||
                            errMsg.includes("UNAVAILABLE") ||
                            errMsg.includes("stream terminated") ||
                            errMsg.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : errMsg;
        return { success: false as const, error: userFriendlyMessage};
    }
}

// ============================================
// MEMBER ID CARD
// ============================================

export type MemberIdCardData = { fullName: string;
    memberNumber: string;
    membershipTier: string;
    gender: string;
    stateOfOrigin: string;
    passportPhotoUrl: string | null;
    joinedAt: string;
    validUntil: string;
    membershipStatus: string;
    paymentStatus: string; };

/**
 * Get member data for ID card rendering.
 * Gate 1: paymentStatus === 'completed' (Paystack verified)
 * Gate 2: membershipStatus === 'active' (admin approved)
 */
export async function getCooperativeMemberIdCardAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Not authenticated", reason: "not_member"};
        const { session } = sessionResult;

        const userId = session.user.id;

        // Fetch central user profile to get real name and paid subscription tier
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : null;

        // Check if user is an active premium/paid plan subscriber in the Academy
        const userPlan = (userData?.serviceRegistrations?.academy?.plan || "free").toLowerCase();
        const isPremiumSubscriber = ["elite", "standard", "foundation", "advanced"].includes(userPlan);

        // NOTE: .orderBy removed — requires composite index (userId+createdAt) that crashes without deploy.
        // In-memory sort below handles ordering (users have at most 1-2 membership docs).
        const memberSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .limit(5)
            .get();


        // Sort in memory: most recent createdAt first (mirrors the removed .orderBy)
        let sortedDocs = memberSnapshot.docs.sort((a, b) => {
            const aTs = a.data().createdAt?.toMillis?.() ?? 0;
            const bTs = b.data().createdAt?.toMillis?.() ?? 0;
            return bTs - aTs;
        });

        // ── FALLBACK 2: Direct document ID lookup ──────────────────────────────
        if (sortedDocs.length === 0) {
            const docRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const docSnap = await runQueryWithRetry(() => docRef.get());
            if (docSnap.exists) {
                logger.info(`[getCooperativeMemberIdCardAction] Found membership via DocID fallback for user: ${userId}`);
                const docData = docSnap.data()!;
                if (!docData.userId) {
                    await docRef.update({ userId });
                }
                sortedDocs = [docSnap];
            }
        }

        // ── FALLBACK 3: Email query ────────────────────────────────────────────
        if (sortedDocs.length === 0) {
            const userEmail = userData?.email;
            if (userEmail) {
                const emailQuery = await runQueryWithRetry(() =>
                    db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("email", "==", userEmail.toLowerCase())
                        .limit(1)
                        .get()
                );
                if (!emailQuery.empty) {
                    logger.info(`[getCooperativeMemberIdCardAction] Found membership via Email fallback for user: ${userId}`);
                    const memberDoc = emailQuery.docs[0];
                    if (!memberDoc.data().userId) {
                        await memberDoc.ref.update({ userId });
                    }
                    sortedDocs = [memberDoc];
                }
            }
        }

        // ── FALLBACK 4: processed_payments ────────────────────────────────────
        if (sortedDocs.length === 0) {
            logger.warn(`[getCooperativeMemberIdCardAction] All direct lookups failed for ${userId} — checking processed_payments`);
            const paymentSnap = await runQueryWithRetry(() =>
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                    .where("userId", "==", userId)
                    .where("type", "==", "cooperative_membership_registration")
                    .where("status", "==", "completed")
                    .limit(1)
                    .get()
            );

            if (!paymentSnap.empty) {
                const paymentData = paymentSnap.docs[0].data();
                const paymentReference = paymentData.reference;
                logger.info(`[getCooperativeMemberIdCardAction] Found completed payment ${paymentReference} for ${userId} — locating member doc by paymentReference`);

                const memberByRefQuery = await runQueryWithRetry(() =>
                    db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("paymentReference", "==", paymentReference)
                        .limit(1)
                        .get()
                );

                if (!memberByRefQuery.empty) {
                    const memberDoc = memberByRefQuery.docs[0];
                    logger.info(`[getCooperativeMemberIdCardAction] Healed orphaned member doc ${memberDoc.id} → userId=${userId}`);
                    await memberDoc.ref.update({ userId, updatedAt: FieldValue.serverTimestamp() });
                    sortedDocs = [memberDoc];
                } else {
                    logger.info(`[getCooperativeMemberIdCardAction] No member doc found — synthesising from payment for ${userId}`);
                    const newMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
                    await newMemberRef.set({
                        userId,
                        email: userData?.email || "",
                        firstName: userData?.firstName || "",
                        lastName: userData?.lastName || "",
                        fullName: userData?.fullName || userData?.displayName || "",
                        phone: userData?.phone || "",
                        paymentStatus: "completed",
                        paymentReference,
                        membershipStatus: "pending",
                        membershipTier: paymentData.tier || "Member",
                        createdAt: paymentData.processedAt || FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp(),
                        _healedFromPayment: true,
                    }, { merge: true });
                    const healedSnap = await newMemberRef.get();
                    sortedDocs = [healedSnap];
                }
            }
        }

        if (sortedDocs.length === 0 && !isPremiumSubscriber) {
            return { success: false as const, error: "No cooperative membership found.", reason: "not_member"};
        }

        let d = sortedDocs.length === 0 ? null : sortedDocs[0].data()!;

        // 1. Resolve real name and completely avoid placeholder values
        const isPlaceholder = (name: string) => {
            if (!name) return true;
            const lower = name.toLowerCase();
            return lower === "general_user" || lower.includes("kusuconsult") || lower === "general user" || lower === "null" || lower === "undefined";
        };

        let resolvedName = "";
        
        // Check central user profile name first
        if (userData) {
            const centralName = (userData.name || userData.fullName || userData.displayName || "").trim();
            if (!isPlaceholder(centralName)) resolvedName = centralName;
        }
        
        // Check session user name
        if (!resolvedName && session.user.name) {
            const sessName = session.user.name.trim();
            if (!isPlaceholder(sessName)) resolvedName = sessName;
        }

        // Check cooperative member record firstName and lastName
        if (!resolvedName && d) {
            const coopName = `${d.firstName || ""} ${d.lastName || ""}`.trim();
            if (!isPlaceholder(coopName)) resolvedName = coopName;
        }

        // Search in all candidates for any non-placeholder name
        if (!resolvedName) {
            const candidates = [
                userData?.name,
                userData?.fullName,
                session.user.name,
                d ? `${d.firstName || ""} ${d.lastName || ""}` : ""
            ];
            for (const cand of candidates) {
                if (cand && !isPlaceholder(cand.trim())) {
                    resolvedName = cand.trim();
                    break;
                }
            }
        }

        // Fall back cleanly if everything is empty or placeholder
        if (!resolvedName) {
            const rawName = (userData?.name || userData?.fullName || session.user.name || (d ? `${d.firstName || ""} ${d.lastName || ""}` : "")).trim();
            if (rawName && !isPlaceholder(rawName)) {
                resolvedName = rawName;
            } else {
                const email = userData?.email || session.user.email || "";
                if (email) {
                    const prefix = email.split("@")[0];
                    resolvedName = prefix.split(/[._-]/).map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
                } else {
                    resolvedName = "Cooperative Member";
                }
            }
        }

        // If cooperative membership doc is missing but user is a premium subscriber, synthesize one
        if (!d) {
            d = {
                firstName: userData?.firstName || resolvedName.split(" ")[0] || "Cooperative",
                lastName: userData?.lastName || resolvedName.split(" ").slice(1).join(" ") || "Member",
                gender: userData?.gender || "",
                stateOfOrigin: userData?.stateOfOrigin || userData?.state || "",
                documents: { passportPhoto: { url: userData?.passportPhotoUrl || userData?.photoUrl || null } },
                membershipStatus: "active",
                paymentStatus: "completed",
                membershipTier: userPlan.charAt(0).toUpperCase() + userPlan.slice(1)
            };
        }

        // Standard gating bypass for premium subscription plan holders
        if (!isPremiumSubscriber) {
            const isLegacy = d.isLegacy === true || !!userData?.legacyOnboardedBy;
            let isApprovedOrActive = d.membershipStatus === "active" || d.membershipStatus === "approved" || d.status === "approved";

            const isCentralActive = 
                userData?.serviceRegistrations?.cooperative?.status === "active" ||
                userData?.serviceRegistrations?.cooperatives?.status === "active" ||
                userData?.serviceRegistrations?.cooperative?.status === "approved" ||
                userData?.serviceRegistrations?.cooperatives?.status === "approved";

            // If the user is active/approved centrally, or has paid and completed onboarding, auto-activate them and heal their database record
            if (!isApprovedOrActive && (isCentralActive || (d.paymentStatus === "completed" && d.onboardingCompleted === true))) {
                isApprovedOrActive = true;
                try {
                    const docId = sortedDocs[0]?.id || userId;
                    const healRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(docId);
                    await healRef.set({ membershipStatus: "active", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        serviceRegistrations: {
                            cooperatives: { status: "active" }
                        }
                    }, { merge: true });
                    logger.info(`[getCooperativeMemberIdCardAction] Auto-healed membershipStatus to 'active' for user ${userId}`);
                } catch (healErr: any) {
                    logger.warn(`[getCooperativeMemberIdCardAction] Auto-heal update failed (non-fatal):`, healErr);
                }
            }

            // Gate 1: Paystack payment must be verified.
            // AUTHORITATIVE FALLBACK: If the member doc shows paymentStatus !== "completed"
            // (can happen due to race conditions, webhook failures, or cold-start DB errors),
            // double-check the processed_payments collection — the source of truth for all
            // Paystack-confirmed transactions. If a completed registration payment exists,
            // honour it and heal the member doc so subsequent requests are fast.
            let effectivePaymentCompleted = d.paymentStatus === "completed";

            if (!effectivePaymentCompleted && !isLegacy && !isApprovedOrActive) {
                try {
                    const authPayment = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                        .where("userId", "==", userId)
                        .where("type", "==", "cooperative_membership_registration")
                        .where("status", "==", "completed")
                        .limit(1)
                        .get();

                    if (!authPayment.empty) {
                        effectivePaymentCompleted = true;
                        // Heal the member doc so this fallback is never needed again for this user
                        try {
                            const healRef = sortedDocs.length > 0
                                ? db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(sortedDocs[0].id)
                                : db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
                            await healRef.set(
                                { paymentStatus: "completed", updatedAt: FieldValue.serverTimestamp() },
                                { merge: true }
                            );
                            // Also heal the USERS doc for middleware gating
                            await db.collection(COLLECTIONS.USERS).doc(userId).set({
                                serviceRegistrations: {
                                    cooperatives: { paymentStatus: "completed" }
                                }
                            }, { merge: true });
                            logger.info(`[getCooperativeMemberIdCardAction] Healed stale paymentStatus for user ${userId} from processed_payments`);
                        } catch (healErr: any) {
                            logger.warn(`[getCooperativeMemberIdCardAction] Heal write failed (non-fatal):`, healErr);
                        }
                        // Update in-memory doc so Gate 2 evaluation below is accurate
                        d = { ...d, paymentStatus: "completed" };
                    }
                } catch (lookupErr: any) {
                    logger.warn(`[getCooperativeMemberIdCardAction] processed_payments fallback failed (non-fatal):`, lookupErr);
                }
            }

            if (!effectivePaymentCompleted && !isLegacy && !isApprovedOrActive) {
                return { success: false as const, error: "Your membership fee payment has not been verified. Please complete payment to access your ID card.", reason: "payment_required"};
            }

            // Gate 2: Admin must have approved
            if (!isApprovedOrActive) {
                return {
                    success: false as const,
                    error: "Your membership is pending admin approval. Your ID card will be available once approved.",
                    reason: "pending_approval",
                    data: null
                };
            }
        }

        // Deterministic member number (based on application year, not approval year)
        const applicationDate: Date = d.createdAt?.toDate ? d.createdAt.toDate() : (userData?.createdAt?.toDate ? userData.createdAt.toDate() : new Date());
        const joinYear = applicationDate.getFullYear();

        // Lock in stored member number permanently (fallback to ESE-COOP-XXXX only if missing)
        const membershipTier = "Member";
        const memberNumber = d.memberNumber || d.memberId || userData?.memberNumber || `ESE-COOP-${(sortedDocs[0]?.id || userId).slice(-4).toUpperCase()}`;

        // Robust passport photo fallback chain (checks doc & central user profile)
        const resolvedPassportPhotoUrl = 
            d.documents?.passportPhoto?.url ||
            (typeof d.documents?.passportPhoto === "string" ? d.documents.passportPhoto : null) ||
            d.passportPhotoUrl ||
            d.photoUrl ||
            userData?.passportPhotoUrl ||
            userData?.photoUrl ||
            userData?.documents?.passportPhoto?.url ||
            (typeof userData?.documents?.passportPhoto === "string" ? userData.documents.passportPhoto : null) ||
            null;

        // Issue date = approvedAt (when admin approved) — not createdAt (when applied).
        const issuedAt: Date =
            d.approvedAt?.toDate
                ? d.approvedAt.toDate()
                : d.approvedAt instanceof Date
                    ? d.approvedAt
                    : applicationDate;

        const validUntil = new Date(issuedAt);
        validUntil.setFullYear(validUntil.getFullYear() + 1);

        return { error: null, success: true as const, data: {
                fullName: resolvedName,
                memberNumber,
                membershipTier,
                gender: d.gender || "",
                stateOfOrigin: d.stateOfOrigin || "",
                passportPhotoUrl: resolvedPassportPhotoUrl,
                joinedAt: issuedAt.toISOString(),
                validUntil: validUntil.toISOString(),
                membershipStatus: d.membershipStatus || "active",
                paymentStatus: d.paymentStatus || "completed" } };
    } catch (error) {
        if (error && typeof error === 'object' && 'digest' in error &&
            typeof (error as any).digest === 'string' &&
            (error as any).digest.startsWith('NEXT_REDIRECT')) {
            throw error;
        }
        logger.error("getCooperativeMemberIdCardAction error:", error);
        return { success: false as const, error: "Failed to load ID card data. Please try again.", data: null };
    }
}

/**
 * Update passport photo for existing cooperative members
 * Works for members at any status (pending, active) who need to add/replace their passport
 */
export async function updatePassportPhotoAction(
    passportUrl: string,
    passportName: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Not authenticated", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // Fetch central user profile
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : null;
        const userPlan = (userData?.serviceRegistrations?.academy?.plan || "free").toLowerCase();
        const isPremiumSubscriber = ["elite", "standard", "foundation", "advanced"].includes(userPlan);

        const memberSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        if (memberSnapshot.empty) { 
            if (isPremiumSubscriber) {
                const resolvedName = (userData?.name || userData?.fullName || session.user.name || "").trim();
                const firstName = userData?.firstName || resolvedName.split(" ")[0] || "Cooperative";
                const lastName = userData?.lastName || resolvedName.split(" ").slice(1).join(" ") || "Member";
                
                await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).set({
                    userId,
                    firstName,
                    lastName,
                    fullName: resolvedName || `${firstName} ${lastName}`,
                    email: session.user.email || userData?.email || "",
                    phone: userData?.phone || userData?.phoneNumber || "08000000000",
                    membershipTier: userPlan.charAt(0).toUpperCase() + userPlan.slice(1),
                    membershipStatus: "active",
                    status: "active",
                    paymentStatus: "completed",
                    onboardingCompleted: false,
                    documents: {
                        passportPhoto: {
                            name: passportName,
                            url: passportUrl
                        }
                    },
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
                
                revalidatePath("/cooperatives/id-card");
                return { error: null, success: true as const, data: { message: "Passport photo updated" }, meta: null };
            } else {
                return { success: false as const, error: "No cooperative membership found. Please register first.", data: null };
            }
        }

        const memberDoc = memberSnapshot.docs[0];
        await memberDoc.ref.update({
            "documents.passportPhoto": {
                name: passportName,
                url: passportUrl
            },
            passportPhotoUrl: passportUrl,
            updatedAt: FieldValue.serverTimestamp()
        });

        // Also update central users table for consistency
        try {
            await db.collection(COLLECTIONS.USERS).doc(userId).set({
                passportPhotoUrl: passportUrl,
                documents: {
                    passportPhoto: {
                        name: passportName,
                        url: passportUrl
                    }
                },
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (uErr) {
            logger.warn(`Failed syncing passport photo to users table (non-fatal):`, uErr);
        }

        revalidatePath("/cooperatives/id-card");

        return { error: null, success: true as const, data: { message: "Passport photo updated" }, meta: null };
    } catch (error) { logger.error("updatePassportPhotoAction error:", error);
        return { success: false as const, error: "Failed to update passport photo. Please try again.", data: null };
    }
}

// ============================================
// COOPERATIVE INVITES
// ============================================

export async function validateCooperativeInviteAction(
    token: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        if (!token) return { success: false as const, error: "Invalid token", data: null };

        const inviteRef = db.collection(COLLECTIONS.COOPERATIVES_INVITES).doc(token);
        const inviteDoc = await inviteRef.get();

        if (!inviteDoc.exists) { return { success: false as const, error: "Invalid or expired invitation link.", data: null };
        }

        const data = inviteDoc.data()!;

        if (data.status !== "pending") { return { success: false as const, error: "This invitation has already been used or revoked.", data: null };
        }

        return { error: null, success: true as const, data: { message: "Invite valid" },
            meta: null
        };

    } catch (error: any) { logger.error("validateCooperativeInviteAction error:", error);
        return { success: false as const, error: "Failed to validate invitation link. Please try again.", data: null };
    }
}

/**
 * Update gender and stateOfOrigin for existing/synthesized cooperative members
 */
export async function updateMemberProfileDetailsAction(
    gender: string,
    stateOfOrigin: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Not authenticated", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // Clean & Validate Gender — normalize to lowercase to match platform-wide standard
        const normalizedGender = gender.trim().toLowerCase();
        if (normalizedGender !== "male" && normalizedGender !== "female") {
            return { success: false as const, error: "Invalid gender selection. Please choose Male or Female.", data: null };
        }

        // Clean & Validate State of Origin
        const normalizedState = stateOfOrigin.trim();
        const validStates = Object.keys(NIGERIAN_LOCATIONS);
        if (!validStates.includes(normalizedState)) {
            return { success: false as const, error: `Invalid state of origin: ${normalizedState}`, data: null };
        }

        // Update Central User Profile Doc (updates both nested and dot-notation keys)
        await db.collection(COLLECTIONS.USERS).doc(userId).update(normalizeUserUpdate({
            gender: normalizedGender,
            stateOfOrigin: normalizedState,
            state: normalizedState,
            updatedAt: FieldValue.serverTimestamp()
        }));

        // Fetch central user profile to handle premium subscribers who have synthesized profiles
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : null;
        const userPlan = (userData?.serviceRegistrations?.academy?.plan || "free").toLowerCase();
        const isPremiumSubscriber = ["elite", "standard", "foundation", "advanced"].includes(userPlan);

        // Fetch Cooperative Member record
        const memberSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .limit(5)
            .get();

        const sortedDocs = memberSnapshot.docs.sort((a, b) => {
            const aTs = a.data().createdAt?.toMillis?.() ?? 0;
            const bTs = b.data().createdAt?.toMillis?.() ?? 0;
            return bTs - aTs;
        });

        if (sortedDocs.length === 0) {
            if (isPremiumSubscriber) {
                // Synthesize member record if premium subscriber but no doc exists
                const resolvedName = (userData?.name || userData?.fullName || session.user.name || "").trim();
                const firstName = userData?.firstName || resolvedName.split(" ")[0] || "Cooperative";
                const lastName = userData?.lastName || resolvedName.split(" ").slice(1).join(" ") || "Member";

                await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).set({
                    userId,
                    firstName,
                    lastName,
                    fullName: resolvedName || `${firstName} ${lastName}`,
                    email: session.user.email || userData?.email || "",
                    phone: userData?.phone || userData?.phoneNumber || "08000000000",
                    membershipTier: userPlan.charAt(0).toUpperCase() + userPlan.slice(1),
                    membershipStatus: "active",
                    status: "active",
                    paymentStatus: "completed",
                    onboardingCompleted: false,
                    gender: normalizedGender,
                    stateOfOrigin: normalizedState,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                return { success: false as const, error: "No cooperative membership found. Please register first.", data: null };
            }
        } else {
            // Update the existing member doc
            const memberDoc = sortedDocs[0];
            await memberDoc.ref.update({
                gender: normalizedGender,
                stateOfOrigin: normalizedState,
                updatedAt: FieldValue.serverTimestamp()
            });
        }

        // Invalidate cache and revalidate paths
        await invalidateUserCache(userId);
        revalidatePath("/cooperatives/id-card");

        return { error: null, success: true as const, data: { message: "Profile details updated successfully" }, meta: null };
    } catch (error) {
        logger.error("updateMemberProfileDetailsAction error:", error);
        return { success: false as const, error: "Failed to update profile details. Please try again.", data: null };
    }
}

