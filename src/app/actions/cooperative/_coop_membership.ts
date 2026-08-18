"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { autoProvisionZereCooperative, autoProvisionLegacyCooperative } from "@/lib/cooperative-provisioning";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import type { CooperativeMembership, GetMembershipState } from "@/lib/types/cooperative";
import { serializeDoc } from "@/lib/firestore-serialize";
import { registerCooperativeMemberAction } from "./_coop_registration";
import { isAdmin } from "@/lib/admin-permissions";
import { mayClaimMembershipByEmail } from "@/lib/cooperative-membership-claim";

/** How many members one directory read will return. */
const DIRECTORY_ROW_CAP = 2000;

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
                    // See lib/cooperative-membership-claim.ts: an email match is
                    // not proof of ownership, and this bound the row permanently.
                    const emailDocRef = emailQuery.docs[0].ref;
                    const emailDocData = emailQuery.docs[0].data();
                    const mayClaim = await mayClaimMembershipByEmail(
                        db, { data: emailDocData, id: emailQuery.docs[0].id }, userId,
                    );
                    if (!mayClaim) {
                        return { error: "No membership found", success: false as const, data: null };
                    }
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
                    // Same rule as the reader above: this branch feeds a healing
                    // path that writes the cooperative_member ROLE onto the user
                    // document, so adopting a stranger's membership here granted
                    // module access as well as visibility.
                    const mayClaim = await mayClaimMembershipByEmail(
                        db,
                        { data: emailQuery.docs[0].data(), id: emailQuery.docs[0].id },
                        session.user.id,
                    );
                    if (mayClaim) {
                        memberDocData = emailQuery.docs[0].data();
                        memberRef = emailQuery.docs[0].ref;
                    }
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
        if (!session?.user) { return { error: "Unauthorized", success: false as const, data: null };
        }

        // THE MEMBER DIRECTORY WAS OPEN TO EVERY SIGNED-IN ACCOUNT.
        //
        // The guard was `if (!session?.user)` under a comment that asked the
        // question and did not answer it: "Allow any logged in user? Or just
        // admin? Assuming members can view directory."
        //
        // The page this serves, /cooperatives/directory, sits under a layout that
        // calls checkModuleAccess(userId, roles, "cooperatives") and redirects
        // anyone without it to onboarding. But the layout guards the PAGE, and
        // this is an exported server action — a reachable HTTP endpoint whether or
        // not a page calls it. Anyone with any account could ask it directly.
        //
        // And it is not a list of names. Every row carries the member's phone
        // number, their passport photograph URL, their occupation and their LGA
        // and state. That is the personal data of every cooperative member,
        // handed to any registered stranger.
        //
        // Same rule as the layout, so the two cannot answer differently.
        const { checkModuleAccess } = await import("@/lib/module-access-check");
        const hasAccess = await checkModuleAccess(
            session.user.id,
            (session.user.roles || []) as any,
            "cooperatives"
        );

        if (!hasAccess && !isAdmin(session.user.roles)) {
            return { error: "Cooperative membership is required to view the member directory", success: false as const, data: null };
        }

        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        // Query both "active" (canonical since May 2026) and "approved" (legacy status) — both are fully approved members.
        const snapshot = await membershipsRef
            .where("membershipStatus", "in", ["approved", "active"])
            .limit(DIRECTORY_ROW_CAP)
            .get();

        // Say so when the directory is a portion.
        //
        // The query was unbounded, so the adapter capped it at its default limit
        // and the page presented whatever came back as the whole membership —
        // the same silent truncation the loans export and the admin queue both
        // carried. The cap is explicit now and reported.
        const truncated = snapshot.docs.length >= DIRECTORY_ROW_CAP
            || Boolean((snapshot as any).truncated);
        if (truncated) {
            logger.warn(
                `[getDirectoryMembers] hit the ${DIRECTORY_ROW_CAP}-row cap — the directory shown is incomplete`
            );
        }

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

        return { error: null, success: true as const, data: members, truncated, rowCap: DIRECTORY_ROW_CAP, meta: null };

    } catch (error) { logger.error("Failed to fetch directory:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Failed to load directory", success: false as const, data: null };
    }
}

export const getDirectoryMembersAction = withFlexibleSafeAction("getDirectoryMembersAction", _getDirectoryMembersAction);
