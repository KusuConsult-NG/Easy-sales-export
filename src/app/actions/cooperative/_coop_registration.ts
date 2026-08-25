"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { logAuditAction } from "@/app/actions/audit";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { COLLECTIONS } from "@/lib/types/firestore";
import { cooperativeMembershipSchema, type MembershipRegistrationState } from "@/lib/types/cooperative";
import { parseFormData } from "@/lib/form-validation";
import type { JoinCooperativeState } from "@/lib/types/cooperative";
import { serializeValue, toMillis } from "@/lib/firestore-serialize";
import { claimStatusTransition } from "@/lib/status-transition";
import { inviteRefusalReason, INVITE_WRONG_ACCOUNT_MESSAGE } from "@/lib/cooperative-invite";
import { mayClaimMembershipByEmail } from "@/lib/cooperative-membership-claim";
import { revalidatePath } from "next/cache";
import { registrationProgressScore } from "@/lib/registration-progress";
import { cooperativeIdentityConflict } from "@/lib/cooperative-identity-conflict";

/**
 * 2. COMPLETE REGISTRATION (Step 2)
 * Submits profile data after payment is confirmed.
 */
export async function registerCooperativeMemberAction(
    formData: FormData
): Promise<MembershipRegistrationState> {
    /** Set once an invite token has been consumed, so a later failure can return it. */
    let claimedInvite: string | null = null;

    try {
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

            // ONE TOKEN, ONE MEMBERSHIP.
            //
            // The token was read here and marked "used" much later, by a blind
            // `transaction.update` inside runTransaction — which takes no lock on
            // this adapter. Two registrations submitted with the same link both
            // read `status: "pending"` and both wrote "used", and an invite is
            // what waives the ₦ registration fee: `paymentStatus: "completed"` is
            // set from `if (inviteToken)` alone. So one invitation could admit
            // two fee-free members.
            //
            // Claimed here rather than in the transaction, because a claim made
            // after the membership is written cannot refuse anything — the member
            // is already recorded as paid by then. Burning the token on a later
            // failure is the cost, and it is compensated below.
            const inviteClaim = await claimStatusTransition({
                collection: COLLECTIONS.COOPERATIVES_INVITES,
                id: inviteToken,
                from: "pending",
                to: "used",
                patch: {
                    usedBy: userId,
                    usedAt: new Date().toISOString(),
                },
            });

            if (!inviteClaim.claimed) {
                return {
                    error: "This invitation has already been used or revoked.",
                    success: false as const,
                    data: null,
                };
            }

            claimedInvite = inviteToken;
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
        //
        // The rule moved to lib/cooperative-identity-conflict.ts so the RESUBMIT
        // path can ask it too — it never did, and it writes the same fields to
        // the same collection. See that file for what the original comparison
        // got wrong (the document id rather than `userId`, one row rather than
        // the matching set, and one spelling of each value rather than both).
        const identityConflict = await runQueryWithRetry(() =>
            cooperativeIdentityConflict(db, userId, validatedData.phone, validatedData.email));

        if (identityConflict) {
            return { error: identityConflict, success: false as const, data: null };
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

            // The invite was marked used here, blind. It is claimed before the
            // transaction now — see the note at the claim.

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

        // Give the invitation back.
        //
        // The token is claimed before the writes, which is the only order that
        // can refuse a second use — but it means a failure afterwards would
        // otherwise leave an invited member holding a link that now reports
        // "already used", with no way to register and no fee waiver. The most
        // common failure here is the transient network one this very handler
        // classifies below, where retrying is exactly what the member is told
        // to do.
        //
        // Released only from "used", so a token some other registration has
        // since consumed is left alone.
        if (claimedInvite) {
            try {
                await claimStatusTransition({
                    collection: COLLECTIONS.COOPERATIVES_INVITES,
                    id: claimedInvite,
                    from: "used",
                    to: "pending",
                    patch: { usedBy: null, usedAt: null },
                });
            } catch (releaseError) {
                logger.error(
                    "[registerCooperativeMember] invitation could not be released after a failed "
                    + "registration — the member cannot retry with this link and needs a new invite.",
                    { token: claimedInvite, error: releaseError instanceof Error ? releaseError.message : String(releaseError) }
                );
            }
        }

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

        // AN UNPAID CONTRIBUTION, CREDITED IN FULL.
        //
        // `initialContribution` is a "use server" parameter, so it is whatever
        // the caller sent regardless of its declared type — and nothing in the
        // UI calls this action, which does not make it unreachable: every
        // exported server action is a public endpoint.
        //
        // It was written straight through as `savingsBalance`, as a COMPLETED
        // `contribution` row in both the cooperative and the universal ledger,
        // and incremented into the cooperative's `totalSavings`. No payment was
        // taken anywhere in this function. So one call credited the caller any
        // sum they named, in books an admin reads and reconciles — and the
        // cooperative loan limit is a multiple of savings balance
        // (lib/cooperative-utils.ts), so it was borrowing power too.
        //
        // Contributions have a paid path. Joining is not it: this creates the
        // membership at zero and the member contributes through the flow that
        // takes the money.
        if (initialContribution !== 0) {
            logger.warn(
                "[joinCooperativeAction] refused an initial contribution — joining does not move money",
                { userId, cooperativeId, initialContribution },
            );
            return {
                error: "Contributions are made from the cooperative dashboard, not when joining.",
                success: false as const,
                data: null,
            };
        }

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

        // AND THE MEMBERSHIP IT CREATED WAS ALREADY ACTIVE.
        //
        // `status: "active"` on a row this function writes with no registration
        // fee, no onboarding and no admin. Two readers act on it:
        //
        //   checkModuleAccess Layer 2.6 takes `membershipStatus || status`, so
        //   "active" here granted the whole cooperative module — dashboard,
        //   contributions, loans, withdrawals.
        //
        //   canTransactAsMember reads the same pair, so the new member could
        //   transact immediately.
        //
        // Every other way into this cooperative — registerCooperativeMember, the
        // Paystack webhook, the admin approval — makes a member pending until
        // the fee is confirmed. This one door did not, so calling it was a
        // complete bypass of the other three.
        //
        // "pending" is what the paid path writes before payment clears, so the
        // webhook and the admin screen already know how to advance it.
        batch.set(newMemberRef, { userId,
            cooperativeId,
            savingsBalance: 0,
            loanBalance: 0,
            memberSince: FieldValue.serverTimestamp(),
            monthlyTarget: 50000,
            membershipStatus: "pending",
            paymentStatus: "pending",
            onboardingCompleted: false,
            status: "pending"
        });

        const cooperativeUpdateData: Record<string, FieldValue | number> = { memberCount: FieldValue.increment(1)
        };

        batch.update(cooperativeRef, cooperativeUpdateData);
        await batch.commit();

        revalidatePath("/cooperatives");
        // /dashboard/cooperatives has no route — the cooperative dashboard is
        // /cooperatives/dashboard, which is revalidated on the line below. A
        // revalidatePath on a path with no route is a silent no-op, so this
        // line invalidated nothing at all. Same as the academy and export
        // dashboards, fixed in their own passes.
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
                    // See lib/cooperative-membership-claim.ts — this returns the
                    // application for editing, KYC and documents included.
                    const memberDoc = emailQuery.docs[0];
                    const mayClaim = await mayClaimMembershipByEmail(
                        db, { data: memberDoc.data(), id: memberDoc.id }, session.user.id,
                    );
                    if (!mayClaim) {
                        return { success: false as const, error: 'No application found'};
                    }
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

        const sortedDocs = snap.docs.map(d => d.data()).sort((a: any, b: any) => { const aTime = toMillis(a.createdAt);
            const bTime = toMillis(b.createdAt);
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


        let registration = coopReg || legacyReg;
        if (coopReg && legacyReg) {
            const scorePlural = registrationProgressScore(coopReg.status || '');
            const scoreSingular = registrationProgressScore(legacyReg.status || '');
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
        /** True when there is no member row yet, so the write must CREATE one. */
        let memberIsNew = false;
        if (snap.empty) {
            const docRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id);
            const docSnap = await runQueryWithRetry(() => docRef.get());
            if (docSnap.exists) {
                memberRef = docRef;
                existingMemberData = docSnap.data();
            } else {
                // THE "AUTO-HEAL" SAVED NOTHING.
                //
                // This branch says it falls back to "new registration creation",
                // and then the commit below did `batch.update(memberRef, ...)`.
                // update() on a missing document is a documented NO-OP in this
                // adapter — it logs "no rows will be affected. Use set(data,
                // { merge: true }) if the document may not exist yet" and
                // returns. So the member filled in the entire KYC form,
                // pressed Resubmit, was told it succeeded, and no member record
                // existed afterwards. The user document WAS updated to
                // "pending", so the screen then showed them waiting for a review
                // of an application that was never written. Repeatable for ever.
                //
                // The branch is right — a member whose row was lost must be able
                // to recreate it. The write was the wrong verb.
                logger.info(`[resubmitCooperativeApplication] Member doc not found for user ${session.user.id} — falling back to new registration creation.`);
                memberRef = docRef;
                existingMemberData = {};
                memberIsNew = true;
            }
        } else {
            const sortedDocs = snap.docs.sort((a, b) => { const aTime = toMillis(a.data().createdAt);
                const bTime = toMillis(b.data().createdAt);
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

        // The same identity guard the SUBMIT path applies — this path had none.
        // A member in revision_required could resubmit carrying somebody else's
        // phone number or email address and it went straight through, into the
        // roster the admin screens and the broadcast tools read.


        const identityConflict = await runQueryWithRetry(() =>
            cooperativeIdentityConflict(db, session.user.id, validatedData.phone, validatedData.email));

        if (identityConflict) {
            return { success: false as const, error: identityConflict };
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
        // set(merge) when the row has to be created, update when it exists — see
        // the fallback branch above for what the unconditional update() did.
        // merge keeps this identical to update() for an existing row, so the
        // path that always worked is unchanged.
        if (memberIsNew) {
            batch.set(memberRef, {
                ...updatePayload,
                paymentStatus: existingMemberData?.paymentStatus ?? "pending",
                onboardingCompleted: true,
                createdAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        } else {
            batch.update(memberRef, updatePayload);
        }
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

        // One policy, asked by both doors.
        //
        // This used to check `status !== "pending"` and nothing else — no
        // expiry, and the invite's recorded `email` compared to nothing at all,
        // so a forwarded link admitted whoever held it, fee-free and for ever.
        // See lib/cooperative-invite.ts for why the binding fails CLOSED here
        // when the session-revocation check fails open.
        //
        // The caller's email comes from the session rather than a parameter, so
        // the redemption path in registerCooperativeMember cannot forget to pass
        // it — that is the shape this codebase keeps getting wrong when one rule
        // has two doors. Signed out, the binding is skipped and only status and
        // age are checked: this action is also the onboarding page's link
        // preview, and a preview is not the fee waiver.
        const previewSession = await requireSession();
        const callerEmail = previewSession.session?.user?.email ?? undefined;

        const refusal = inviteRefusalReason(data, callerEmail);
        if (refusal) {
            if (callerEmail && refusal === INVITE_WRONG_ACCOUNT_MESSAGE) {
                logger.warn(
                    "[invite] refused: the link was issued to a different address",
                    { token, caller: callerEmail },
                );
            }
            return { success: false as const, error: refusal, data: null };
        }

        return { error: null, success: true as const, data: { message: "Invite valid" },
            meta: null
        };

    } catch (error: any) { logger.error("validateCooperativeInviteAction error:", error);
        return { success: false as const, error: "Failed to validate invitation link. Please try again.", data: null };
    }
}
