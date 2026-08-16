"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { COLLECTIONS } from "@/lib/types/firestore";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";
import { revalidatePath } from "next/cache";
import type { SupabaseDocumentSnapshot } from "@/lib/supabase-db";

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
        // Typed as the BASE snapshot: the fallbacks below push results of
        // docRef.get(), which is a DocumentSnapshot, into a list that
        // started out as query results. Both are read with .data()!, so the
        // runtime was always fine; the declared element type was not.
        let sortedDocs: SupabaseDocumentSnapshot[] = memberSnapshot.docs.sort((a, b) => {
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
