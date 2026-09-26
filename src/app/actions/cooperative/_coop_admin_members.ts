"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { adminSortKey } from "@/lib/admin-row-sort";
import { invalidateServiceCache } from "@/lib/cache-invalidation";
import { html } from "@/lib/utils";
import { requireSession } from "@/lib/session-guard";
import { requireAdmin } from "@/lib/require-admin";
import { logger } from '@/lib/logger';
import { notifyMemberDecision } from "@/lib/member-decision-notice";
import { supabaseDb as db } from "@/lib/supabase-db";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
// #535 One rule for who may see a member's bank details and ID papers.
import { mayRevealMemberPii } from "@/lib/member-pii-visibility";
import { stripPii } from "@/lib/admin-pii";
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";
import { paginatedOk, paginatedErr, PaginatedAdminResponse } from "@/lib/admin-action-response";
import { COLLECTIONS } from "@/lib/types/firestore";
import { getAdminScope } from "@/lib/cooperative-admin-scope";
import { mergeMemberIdentity, pickDetailRow } from "@/lib/cooperative-member-identity";
import { approvalReadiness, isAdmittingStatus } from "@/lib/cooperative-approval-readiness";
import { createAdminAuditLog } from "@/lib/audit-log";
import { deleteCache, invalidateCooperativeCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";
import { recordAdminAction } from "@/lib/audit-log";
import { sendEmailNotification } from "@/lib/email-notifications";
import { resolveProfileEmail } from "@/lib/profile-email-resolution";

import { joinFullName, namePartsOf } from "@/lib/person-name";
// ============================================================================
// MEMBER MANAGEMENT
// ============================================================================

async function _getAllMembersAction(options?: {
    status?: "all" | "active" | "pending" | "suspended" | string;
    limit?: number;
    search?: string;
}): Promise<ActionResponse<{ members: any[] }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        /**
         * Bank details go only to the callers who can act on these records.
         * Seventh and eighth instances of a list gated more loosely than the
         * action it feeds; see the WAVE withdrawal queue for the six before
         * them.
         *
         *   #535 THIS COMMENT USED TO SAY "`roles` above is the LIVE set this
         *   action already resolves, so the check below inherits that", AND IT
         *   WAS NOT TRUE.
         *
         *   The resolution above is
         *
         *       let roles = session.user.roles;
         *       if (!isAdmin(roles)) { ...read the live roles... }
         *
         *   so the database is consulted ONLY when the token is too NARROW. When
         *   the token already claims admin — the ordinary case, and the
         *   revoked-admin case this whole pattern exists for — `roles` is the
         *   token's, unread and possibly hours stale. The fallback can enlarge a
         *   too-small claim and can never shrink a too-large one.
         *
         *   Asked of the record now, through the one rule the other eleven
         *   bank-details decisions share.
         */
        const maySeeBankDetails = await mayRevealMemberPii("cooperatives:approve_members");

        // Audit logging
        await createAdminAuditLog({
            userId: session.user.id,
            userEmail: session.user.email ?? "unknown",
            action: "FETCH_COOPERATIVE_MEMBERS",
            targetType: "COOPERATIVE_MEMBERS",
            details: JSON.stringify({ status: options?.status, limit: options?.limit })
        });

        const adminScope = await getAdminScope(session.user.id, roles);

        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        if (options?.status && options.status !== "all") {
            if (options.status === "approved" || options.status === "active") {
                q = q.where("membershipStatus", "in", ["approved", "active"]);
            } else {
                q = q.where("membershipStatus", "==", options.status);
            }
        }

        const fetchLimit = options?.search ? 5000 : (options?.limit ? options.limit * 10 : 500);
        q = q.orderBy("createdAt", "desc").limit(fetchLimit);

        let snapshot;
        try {
            snapshot = await q.get();
        } catch (error: any) {
            if (error.code === 9 || error.message?.includes("FAILED_PRECONDITION")) {
                logger.error("Firestore Index Missing for Cooperative Members:", error.message);
                return { 
                    success: false, 
                    error: "Administrative index is currently being provisioned. Please try again in 5 minutes.", 
                    data: null 
                };
            }
            throw error;
        }

        let allMembersRaw = serializeDocs(snapshot.docs);

        if (options?.search) {
            /*
             *   #825 — the same 5,000-row window as the standard members
             *   reader, and the same repair. The filter further down reads
             *   `m.firstName`/`m.lastName`/`m.fullName` off the MEMBER
             *   document, but only for members that this page happened to
             *   fetch. Any member the database matches by name outside the
             *   window is pulled in HERE, before hydration, so she is joined to
             *   her user record like every other row rather than appearing
             *   half-built.
             *
             *   This reader has no screen today; it is exported through
             *   actions/cooperative/index and returns member PII, so it is held
             *   to the same behaviour as the one that does.
             */
            const { searchDocIdsByNameFields } = await import("@/lib/admin-search-helper");
            const matchingMemberIds = await searchDocIdsByNameFields(
                COLLECTIONS.COOPERATIVE_MEMBERS,
                ["firstName", "lastName", "fullName", "otherNames"],
                options.search,
            );
            const missingIds = matchingMemberIds.filter(
                (id) => !allMembersRaw.some(m => m.id === id),
            );
            if (missingIds.length > 0) {
                const extra = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where(FieldPath.documentId(), "in", missingIds).get();
                allMembersRaw = allMembersRaw.concat(serializeDocs(extra.docs));
            }
        }

        // Show ALL members who have a cooperative_members document (including pending/submitted).
        // Previously this filter hid users whose membershipStatus was still "pending" after
        // submitting the form — making them invisible to admins who tried to approve them.
        const membersRaw = allMembersRaw;

        // --- HYDRATION START ---
        const memberUserIds = [...new Set(membersRaw.map(m => m.userId || m.id).filter(Boolean))];
        const userMap = new Map<string, any>();
        
        if (memberUserIds.length > 0) {
            const userPromises = [];
            for (let i = 0; i < memberUserIds.length; i += 30) {
                const chunk = memberUserIds.slice(i, i + 30);
                if (chunk.length > 0) {
                    userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
                }
            }
            const userSnapsArray = await Promise.all(userPromises);
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));
        }
        // --- HYDRATION END ---

        let members = membersRaw.map((m: any) => {
            const uData = userMap.get(m.userId || m.id) || {};
            const canonical = extractCanonicalUser(uData, m);

            return {
                ...m,
                user: {
                    id: m.userId || m.id,
                    name: canonical.name,
                    email: canonical.email,
                    phone: canonical.phone,
                    ...(maySeeBankDetails ? { bankDetails: canonical.bankDetails } : {}),
                }
            };
        });

        if (!options?.search && options?.limit) {
            members = members.slice(0, options.limit);
        }

        if (options?.search) {
            const s = options.search.toLowerCase().trim();
            members = members.filter((m: any) => {
                const searchString = [
                    m.id,
                    m.userId,
                    m.firstName,
                    m.lastName,
                    m.fullName,
                    //   #825 — searched in the database above, so it has to be
                    //   searchable here too or a row is fetched and discarded.
                    m.otherNames,
                    m.email,
                    m.phone,
                    m.bankName,
                    m.accountNumber,
                    m.nin,
                    m.bvn,
                    m.user?.name,
                    m.user?.email
                ].filter(Boolean).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        // `hasMore: false`, hardcoded, over a query that caps at fetchLimit and
        // then slices to options.limit. So this reader always told its caller it
        // had returned every member, whatever it had actually returned — and the
        // 500-row default cap on the underlying query was never reported either.
        //
        // Both are answered honestly now. This action has no caller in the app
        // today (the members page uses getStandardCooperativeMembersAction), but
        // it is an exported server action returning member PII and a reader that
        // lies about completeness is how "the list is missing people" reaches
        // production.
        const truncated = snapshot.docs.length >= fetchLimit;
        if (truncated) {
            logger.warn(
                `[getAllMembers] hit the ${fetchLimit}-row cap — the member list returned is INCOMPLETE`,
                { adminScope, status: options?.status }
            );
        }

        return {
            error: null,
            success: true as const,
            data: { members },
            meta: {
                hasMore: truncated || (!options?.search && !!options?.limit && membersRaw.length > options.limit),
                cursor: null,
                truncated,
                rowCap: fetchLimit,
            },
        };
    } catch (error) {
        logger.error("Get all members error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch members", data: null };
    }
}

export const getAllMembersAction = withFlexibleSafeAction("getAllMembersAction", _getAllMembersAction);


async function _updateMemberStatusAction(
    memberId: string,
    status: "active" | "approved" | "suspended"
): Promise<{ error: string | null, success: boolean; meta?: any; data?: any;  }> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        /*
         *   #955 THE DATABASE WAS READ ONLY WHEN THE TOKEN SAID NO.
         *
         *   The block this replaces asked the token first and consulted the user
         *   record ONLY in the failure branch. So a token claiming the permission was
         *   admitted and never re-checked, while a token LACKING it got a live second
         *   chance — the newly promoted admin was handled and the newly DEMOTED one
         *   was not, which is the case #356 measured in hours.
         *
         *   The comment that stood here is worth keeping on the record: it noted that
         *   the fallback used to be WIDER than the gate (isAdmin where the gate asked
         *   the permission) and narrowed it. That fix was right, and it left the
         *   ordering alone — which is the half that mattered.
         *
         *   `roles` below now carries the LIVE roles unconditionally. It used to carry
         *   the token's whenever the token passed, so every later decision in this
         *   function, the member PII gate included, was made from the token in exactly
         *   the case where the token is wrong.
         */
        const gate = await requireAdmin("cooperatives:approve_members");
        if ("error" in gate) {
            return { success: false as const, error: gate.error, data: null };
        }
        const roles = gate.roles;

        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId);
        const memberDoc = await memberRef.get();
        if (!memberDoc.exists) {
            return { success: false as const, error: "Member not found", data: null };
        }
        
        const memberData = memberDoc.data()!;

        // A SCOPED ADMIN COULD ACT ON ANY COOPERATIVE'S MEMBERS.
        //
        // getAdminScope was called in this function, but only at the end, to
        // pick which cache keys to clear — never to decide whether the caller
        // was entitled to touch this member. Both withdrawal actions in the
        // sibling file carry the check, labelled "Prevent IDOR"; this one, which
        // grants the `cooperative_member` role and sets isVerified, did not.
        //
        // So an administrator scoped to one cooperative could activate, approve
        // or suspend a member of any other.
        //   #248 THE GUARD WAS WRITTEN TO FAIL OPEN ON AN UNLABELLED ROW.
        //
        //        It read `memberScope && memberData.cooperativeId && ...`, so a
        //        membership row carrying NO cooperativeId passed it — and rows
        //        like that are the ordinary case, not an edge: two of the three
        //        doors that create a cooperative withdrawal write no
        //        cooperativeId at all, and autoProvisionZereCooperative writes a
        //        membership without one. A partition that admits every
        //        unattributable row is not a partition.
        //
        //        A scoped admin now refuses a row it cannot attribute. Platform
        //        admins are unaffected — isPlatformAdmin short-circuits
        //        getAdminScope to null — so nothing becomes unactionable.
        //
        //        This changes NOTHING today: getAdminScope returns null for
        //        every caller (#320), so the guard short-circuits before reaching
        //        the comparison. It is here so that whoever wires the scoping up
        //        is not handed a trap. See lib/cooperative-admin-scope.ts for why
        //        it is not being wired up.
        const memberScope = await getAdminScope(session.user.id, roles);
        if (memberScope && memberData.cooperativeId !== memberScope) {
            return {
                success: false as const,
                error: "Unauthorized: Cannot change membership status for another cooperative",
                data: null,
            };
        }

        //   THE SAME RULE AS THE ROUTE, ON THE DOOR BESIDE IT.
        //
        //   The comment further down this function reads "No status guard
        //   here, so there is no check-then-write to claim: this writes
        //   membershipStatus unconditionally." That was true of the ADMISSION
        //   as well, and this is the server action the members screen calls —
        //   api/admin/cooperative/approve-member is the other door onto the
        //   same write. Fixing one of two doors is the defect class this
        //   codebase has recorded more than a dozen times, so the rule is
        //   stated once in lib/cooperative-approval-readiness.ts and asked
        //   here too.
        //
        //   BELOW THE SCOPE GUARD, NOT ABOVE IT. Authorisation first: an
        //   admin who may not touch this member at all is told that, and is
        //   not handed "this member has no name" about somebody else's
        //   cooperative. Written above it first, which is how the IDOR
        //   suite's own refusal message changed underneath it.
        //
        //   SUSPENSION PASSES. isAdmittingStatus is false for it, and an
        //   incomplete record is exactly one an admin may need to act
        //   against.
        if (isAdmittingStatus(status)) {
            const readiness = approvalReadiness(memberData);
            if (!readiness.ready) {
                logger.warn(
                    `[updateMemberStatus] refused: ${memberId} has no ${readiness.missing.join(" and ")}`,
                    { memberId, adminId: session.user.id, missing: readiness.missing },
                );
                return { success: false as const, error: readiness.reason, data: null };
            }
        }

        let targetUserId = memberData.userId;

        if (!targetUserId && memberData.email) {
            // Find user by email
            const userSnap = await db.collection(COLLECTIONS.USERS)
                .where("email", "==", memberData.email.toLowerCase())
                .limit(1)
                .get();
            if (!userSnap.empty) {
                targetUserId = userSnap.docs[0].id;
                // Heal the membership document by setting the userId
                await memberRef.update({ userId: targetUserId });
                logger.info(`[updateMemberStatus] Healed membership ${memberId} with userId ${targetUserId}`);
            }
        }

        if (!targetUserId) {
            targetUserId = memberId; // fallback
        }

        // No status guard here, so there is no check-then-write to claim: this
        // writes membershipStatus unconditionally. The wrapper bought it
        // nothing — the writes below are already atomic on their own
        // (FieldValue.increment and arrayUnion apply in SQL since migrations
        // 010 and 016), which is the whole of what it appeared to provide.
        //
        // The member record is written before the user record, so a crash
        // between them leaves the admin's view ahead of the member's, which is
        // the direction the caching layer already re-syncs.
        const emailData = await (async () => {
            const mRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId);
            const mDoc = await mRef.get();
            if (!mDoc.exists) throw new Error("Member not found");

            // Always fetch the user doc — we need to sync it for BOTH "approved" and "active"
            // BUG FIX: Previously only fetched when status === "active", meaning "approved"
            // never synced to serviceRegistrations → user saw "pending" while admin saw "approved"
            const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
            const userDoc = await userRef.get();

            await mRef.update({
                membershipStatus: status,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
                userId: targetUserId,
            });

            let notificationInfo: { email: string; fullName: string } | null = null;

            if (status === "active" || status === "approved") {
                const userData = userDoc?.data();
                if (userData?.email || memberData?.email) {
                    notificationInfo = {
                        email: userData?.email || memberData.email,
                        fullName: userData?.fullName || joinFullName(namePartsOf(memberData)).trim() || 'Member'
                    };
                }

                const userDocUpdate: Record<string, any> = {
                    isVerified: true,
                    roles: FieldValue.arrayUnion("cooperative_member"),
                    "serviceRegistrations.cooperatives.status": status,
                    "serviceRegistrations.cooperatives.approvedAt": FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                };
                if (status === "active") {
                    userDocUpdate["serviceRegistrations.cooperatives.activatedAt"] = FieldValue.serverTimestamp();
                }

                if (!userDoc || !userDoc.exists) {
                    /**
                     *   #489 THIS MINTED A PROFILE WITH `email: ""`, AND IT IS
                     *        WHERE 48 OF THE OWNER'S 49 BLANK ACCOUNTS CAME
                     *        FROM.
                     *
                     *        `memberData?.email || ""` — an identity field with
                     *        a `|| ""` fallback, looking at one record. A
                     *        membership created by a legacy import or an invite
                     *        may carry no address, and the person's actual
                     *        email is on their AUTH RECORD, which this never
                     *        asked.
                     *
                     *        The result is an account nobody can reach: #479
                     *        established that a blank-email profile is findable
                     *        only by its document id, so the member cannot sign
                     *        in, no admin can search for them, and the forensic
                     *        scan reports them as a ghost — carrying
                     *        `isVerified: true`.
                     *
                     *        REFUSING IS BETTER THAN THAT. The admin gets a
                     *        message naming what is missing and can fix the
                     *        record; the alternative is a row nobody can act
                     *        on. Only this CREATE branch is affected — an
                     *        existing profile is updated exactly as before.
                     */
                    const resolvedEmail = await resolveProfileEmail(targetUserId, [
                        memberData?.email,
                        userDoc?.data()?.email,
                    ]);

                    if (!resolvedEmail) {
                        return {
                            success: false as const,
                            error:
                                `This member has no email address on file, and none could be found on their `
                                + `sign-in record. Add an email to the membership before approving, or the `
                                + `account created here could not be signed into or searched for.`,
                            data: null,
                        };
                    }

                    // Combine initial set and update payload
                    const initialData = {
                        uid: targetUserId,
                        email: resolvedEmail,
                        fullName: joinFullName(namePartsOf(memberData)).trim() || "Cooperative Member",
                        createdAt: FieldValue.serverTimestamp(),
                        roles: ["cooperative_member"],
                        isVerified: true,
                        serviceRegistrations: {
                            cooperatives: {
                                status,
                                approvedAt: FieldValue.serverTimestamp(),
                                ...(status === "active" ? { activatedAt: FieldValue.serverTimestamp() } : {})
                            }
                        },
                        updatedAt: FieldValue.serverTimestamp(),
                        _version: 1
                    };
                    await userRef.set(initialData);
                } else {
                    await userRef.update(normalizeUserUpdate(userDocUpdate));
                }
            } else if (status === "suspended") {
                // SUSPENSION CHANGED A LABEL AND REVOKED NOTHING.
                //
                // This branch did not exist. Suspending wrote
                // `membershipStatus: "suspended"` onto the member document and
                // stopped, leaving the USER document exactly as it was:
                // `roles` still containing "cooperative_member" and
                // `serviceRegistrations.cooperatives.status` still "active".
                //
                // checkModuleAccess grants cooperative access from EITHER —
                // Layer 1 is the JWT role alone, Layer 2 the registration
                // status — so a suspended member kept the dashboard,
                // contributions, loans, withdrawals and the member directory.
                // An admin pressing Suspend achieved nothing except a different
                // word on the admin's own screen.
                //
                // Both are revoked now, which is exactly what the Farm Nation
                // equivalent does when it rejects a seller
                // (farm-nation/_fn_admin.ts strips the `farmer` role the same
                // way). Reactivating re-adds them through the arrayUnion in the
                // branch above, so this is reversible rather than destructive.
                const suspendUpdate: Record<string, any> = {
                    roles: FieldValue.arrayRemove("cooperative_member"),
                    "serviceRegistrations.cooperatives.status": "suspended",
                    "serviceRegistrations.cooperatives.suspendedAt": FieldValue.serverTimestamp(),
                    "serviceRegistrations.cooperatives.suspendedBy": session.user.id,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                };

                if (userDoc?.exists) {
                    await userRef.update(normalizeUserUpdate(suspendUpdate));
                } else {
                    logger.warn(
                        "[updateMemberStatus] suspended a member with no user document — "
                        + "nothing to revoke, which is expected for a legacy import",
                        { memberId, targetUserId }
                    );
                }
            }
            return { notificationInfo, targetUserId };
        })();


        // 4. Invalidate Caches (Kill the "State vs. Truth" bug)
        try {
            if (targetUserId) {
                await invalidateCooperativeCache(targetUserId);
                const { invalidateUserCache } = await import('@/lib/cache-invalidation');
                await invalidateUserCache(targetUserId);
                await invalidateAdminGlobalStats();
                // Clear scoped coop stats
                const adminScope = await getAdminScope(sessionResult.session.user.id, sessionResult.session.user.roles);
                if (adminScope) {
                    await deleteCache(`admin:coop-stats:${adminScope}`);
                    await deleteCache(`admin:coop-reports:${adminScope}`);
                }
            }
        } catch (cacheErr) {
            logger.error("Cache invalidation failed after member status update", cacheErr);
        }

        const { notificationInfo } = emailData || {};

        if (status === "active" && notificationInfo && targetUserId) {
            try {
                const { error } = await sendEmailNotification({
                    from: process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>',
                    to: notificationInfo.email,
                    subject: '✅ Your Cooperative Membership Has Been Approved!',
                    message: html`
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                            <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:32px;border-radius:12px;text-align:center;margin-bottom:24px;">
                                <h1 style="color:white;margin:0;">Welcome to the Cooperative!</h1>
                            </div>
                            <h2 style="color:#7c3aed;">Membership Approved ✅</h2>
                            <p>Dear <strong>${notificationInfo.fullName}</strong>,</p>
                            <p>Congratulations! Your cooperative membership application has been <strong>approved</strong>. You now have full access to cooperative benefits including loans, fixed savings, and member forums.</p>
                            <div style="text-align:center;margin:24px 0;">
                                <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/cooperatives/dashboard" style="background:#7c3aed;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Your Dashboard</a>
                            </div>
                            <p style="color:#6b7280;font-size:14px;">Easy Sales Export Cooperative Team</p>
                        </div>
                    `,
                    metadata: { type: "cooperative_membership" },
                });
                if (error) {
                    logger.error("Resend API Error (Cooperative approval email):", error);
                }
            } catch (emailError) {
                logger.error('Cooperative approval email failed (non-blocking):', emailError);
            }
        }
        await recordAdminAction({
            action: 'cooperative_member_status_update',
            userId: session.user.id,
            targetId: memberId,
            targetType: 'cooperative_member',
            metadata: { status },
        });
        return { error: null, success: true as const, data: null, meta: null };
    } catch (error) {
        logger.error("Update member status error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to update member status", data: null };
    }
}

export const updateMemberStatusAction = withFlexibleSafeAction("updateMemberStatusAction", _updateMemberStatusAction);


// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Admin: Request revision on a cooperative membership application
 */
export async function requestCooperativeRevisionAction(
    memberId: string,
    reason: string
): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!session?.user?.id) {
            return { success: false as const, error: 'Admin access required', data: null };
        }

        /*
         *   #955 THE DATABASE WAS READ ONLY WHEN THE TOKEN SAID NO.
         *
         *   The block this replaces asked the token first and consulted the user
         *   record ONLY in the failure branch. So a token claiming the permission was
         *   admitted and never re-checked, while a token LACKING it got a live second
         *   chance — the newly promoted admin was handled and the newly DEMOTED one
         *   was not, which is the case #356 measured in hours.
         *
         *   The comment that stood here is worth keeping on the record: it noted that
         *   the fallback used to be WIDER than the gate (isAdmin where the gate asked
         *   the permission) and narrowed it. That fix was right, and it left the
         *   ordering alone — which is the half that mattered.
         *
         *   `roles` below now carries the LIVE roles unconditionally. It used to carry
         *   the token's whenever the token passed, so every later decision in this
         *   function, the member PII gate included, was made from the token in exactly
         *   the case where the token is wrong.
         */
        const gate = await requireAdmin("cooperatives:approve_members");
        if ("error" in gate) {
            return { success: false as const, error: gate.error, data: null };
        }
        const roles = gate.roles;

        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(memberId);
        // Two status writes, no balance and no guard to claim. The wrapper made
        // them look like one commit; they never were. They are written member
        // first, user second, for the same reason as updateMemberStatus above.
        const notificationData = await (async () => {
            const memberDoc = await memberRef.get();
            if (!memberDoc.exists) throw new Error('Member not found');

            const memberData = memberDoc.data();
            const userId = memberData?.userId;

            await memberRef.update({
                membershipStatus: 'revision_required',
                revisionNote: reason,
                revisionRequestedAt: FieldValue.serverTimestamp(),
                revisionRequestedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
            });

            if (userId) {
                await db.collection(COLLECTIONS.USERS).doc(userId).update(normalizeUserUpdate({
                    'serviceRegistrations.cooperatives.status': 'revision_required',
                    updatedAt: FieldValue.serverTimestamp(),
                }));
                //   #692 A member sent back for revision reads their own status
                //   through the cached profile.
                await invalidateServiceCache(userId, 'cooperative');
            }

            return {
                //   #941 userId travels with it now: the shared notice rings the
                //   bell as well as emailing, and the bell is keyed on the member
                //   rather than on an address.
                userId,
                email: memberData?.email,
                name: memberData?.firstName ? joinFullName(namePartsOf(memberData)).trim() : 'Member'
            };
        })();

        /*
         *   #941 THROUGH THE SHARED NOTICE — see admin/_exports.ts for the rule.
         *   This path emailed and did not ring the bell, the gap all four of this
         *   platform's revision paths shared.
         *
         *   `/cooperatives/onboarding` is kept as the destination and was checked
         *   to exist — #384 retired `cooperatives/onboarding/success`, not the
         *   onboarding screen itself.
         */
        if (notificationData?.userId) {
            await notifyMemberDecision({
                userId: notificationData.userId,
                userEmail: notificationData.email,
                recipientName: notificationData.name,
                subject: 'Your cooperative membership application',
                outcome: 'revision',
                reason,
                link: '/cooperatives/onboarding',
                linkText: 'Update my application',
            });
        }

        await recordAdminAction({
            action: 'cooperative_revision_request',
            userId: session.user.id,
            targetId: memberId,
            targetType: 'cooperative_member',
            metadata: { reason },
        });
        return { success: true, error: null, data: { message: "Revision requested" }, meta: null };
    } catch (error: any) {
        logger.error('requestCooperativeRevisionAction error:', error);
        return { success: false as const, error: (error as any).message || 'Failed to request revision', data: null };
    }
}


/**
 * Every membership row belonging to the members on this page, grouped by user.
 *
 * One indexed query per thirty members — `idx_cm_user_id` covers
 * `raw_data->>'userId'` (migration 022) — alongside the USERS hydration that
 * was already here, and on the same page-sized set of ids rather than the
 * whole collection.
 *
 * Most members have exactly one row and cost nothing but the lookup. The ones
 * that have two are the reason this exists: see
 * lib/cooperative-member-identity.ts.
 */
async function siblingMemberRowsByUserId(userIds: string[]): Promise<Map<string, any[]>> {
    const byUser = new Map<string, any[]>();
    if (userIds.length === 0) return byUser;

    const chunks: string[][] = [];
    for (let i = 0; i < userIds.length; i += 30) chunks.push(userIds.slice(i, i + 30));

    const snaps = await Promise.all(chunks.map(chunk =>
        db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("userId", "in", chunk).get()));

    for (const snap of snaps) {
        //   Serialised for the same reason the user documents above it are:
        //   a Timestamp reaching a Client Component takes the whole page down
        //   rather than the one field (#903).
        for (const row of serializeDocs(snap.docs)) {
            const uid = (row as any).userId as string | undefined;
            if (!uid) continue;
            const list = byUser.get(uid) || [];
            list.push(row);
            byUser.set(uid, list);
        }
    }
    return byUser;
}

export async function getStandardCooperativeMembersAction(
    options: {
        // "under_review" is gone and "rejected" is here instead.
        //
        // Nothing writes membershipStatus: "under_review" — the only setter,
        // _updateMemberStatusAction, takes "active" | "approved" | "suspended";
        // registration writes "pending"; reject-member writes "rejected". So the
        // filter option offering it returned an empty list that read as "no
        // members are under review".
        //
        // "rejected" is the reverse: written by
        // /api/admin/cooperative/reject-member and impossible to filter for, so
        // rejected members could only be found mixed into everyone else.
        //
        // The state stays in lib/types/firestore.ts. Removing it there is a
        // separate question — it may be a state somebody intends to add — but a
        // filter offering it today is a wrong answer today.
        status?: "pending" | "approved" | "active" | "suspended" | "rejected" | "all";
        paymentStatus?: "pending" | "completed" | "failed" | "unpaid" | "all";
        cursorId?: string;
        limit?: number;
        search?: string;
        dateFrom?: string; // YYYY-MM-DD
        dateTo?: string;   // YYYY-MM-DD
        state?: string;
        lga?: string;
        registry?: "all" | "legacy" | "regular";
        sortBy?: "createdAt" | "gender" | "state";
        sortOrder?: "asc" | "desc";
    } = {}
): Promise<PaginatedAdminResponse<any>> {
    const {
        status: statusFilter = "all",
        paymentStatus: paymentFilter = "all",
        cursorId,
        limit: limitCount = 50,
        search,
        state,
        lga,
        registry
    } = options;
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return paginatedErr('Not authenticated');
        const { session } = sessionResult;
        if (!session?.user?.id) return paginatedErr('Not authenticated');

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const liveRoles = userDoc.data()?.roles;
        if (!isAdmin(liveRoles)) {
            return paginatedErr('Unauthorized');
        }

        // #338. Who may read a member's identity and bank details, as opposed
        // to who may see the roster at all.
        const maySeeMemberPii = hasAdminPermission(liveRoles, "cooperatives:approve_members");

        let cursorSnap = null;
        if (cursorId && !/^\d+$/.test(cursorId)) {
            cursorSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(cursorId).get();
        }

        const useMemoryPagination = !!search || !!options.dateFrom || !!options.dateTo || !!state || !!lga || (registry && registry !== "all") || (options.sortBy === "gender" || options.sortBy === "state");
        const fetchLimit = useMemoryPagination ? 5000 : limitCount;

        const adminScope = await getAdminScope(session.user.id, liveRoles);

        let applications: any[] = [];
        let hasMoreRaw = false;
        let nextCursor: string | undefined = undefined;

        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        // Only apply status and payment filters in Firestore query if not using memory pagination
        if (!useMemoryPagination) {
            if (statusFilter && statusFilter !== "all") {
                if (statusFilter === "approved" || statusFilter === "active") {
                    q = q.where("membershipStatus", "in", ["approved", "active"]);
                } else {
                    q = q.where("membershipStatus", "==", statusFilter);
                }
            }

            if (paymentFilter && paymentFilter !== "all") {
                if (paymentFilter === "completed") {
                    q = q.where("paymentStatus", "==", "completed");
                } else if (paymentFilter === "unpaid" || paymentFilter === "pending") {
                    q = q.where("paymentStatus", "in", ["pending", "unpaid", "failed"]);
                } else {
                    q = q.where("paymentStatus", "==", paymentFilter);
                }
            }
        }

        if (options.dateFrom) {
            const fromTs = dateRangeStart(options.dateFrom);
            q = q.where("createdAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = dateRangeEnd(options.dateTo);
            q = q.where("createdAt", "<=", toTs);
        }

        const orderDirection = options.sortOrder || "desc";
        q = q.orderBy("createdAt", orderDirection);

        if (cursorSnap && cursorSnap.exists && !useMemoryPagination) {
            q = q.startAfter(cursorSnap);
        }
        q = q.limit(fetchLimit + 1);

        let snapshot;
        try {
            snapshot = await q.get();
        } catch (error: any) {
            if (error.code === 9 || error.message?.includes("FAILED_PRECONDITION")) {
                logger.error("Firestore Index Missing for Standard Cooperative Members:", error.message);
                return paginatedErr("Administrative index is currently being provisioned. Please try again in 5 minutes.");
            }
            throw error;
        }
        applications = serializeDocs(snapshot.docs);
        hasMoreRaw = applications.length > fetchLimit;
        if (!useMemoryPagination) {
            applications = applications.slice(0, fetchLimit);
        }
        nextCursor = applications.length > 0 ? applications[applications.length - 1].id as string : undefined;

        // Perform in-memory filtering for cohort if useMemoryPagination is true
        let stats: any = null;
        if (useMemoryPagination) {
            // Apply search filter if active
            if (search) {
                const { searchUserIdsByQuery, searchDocIdsByNameFields } =
                    await import("@/lib/admin-search-helper");
                const [matchingUserIds, matchingMemberIds] = await Promise.all([
                    searchUserIdsByQuery(search),
                    searchDocIdsByNameFields(
                        COLLECTIONS.COOPERATIVE_MEMBERS,
                        ["firstName", "lastName", "fullName", "otherNames"],
                        search,
                    ),
                ]);
                const matchingUserIdsSet = new Set(matchingUserIds);

                /*
                 *   #825 THE SEARCH COULD ONLY SEE THE NEWEST 5,000 MEMBERS.
                 *
                 *   The filter below reads `app.firstName` and `app.lastName`
                 *   off the MEMBER document, which is right — the members table
                 *   labels each row from those same two fields. But it runs
                 *   over `applications`, and that is one `.limit(5000)` window
                 *   ordered by createdAt desc. A member enrolled before the
                 *   newest five thousand was not filtered out; she was never
                 *   fetched, and the screen reported no such person.
                 *
                 *   The name search is issued against the database as well, so
                 *   it is bounded by the query rather than by the page, and any
                 *   member it finds outside the window is pulled in before the
                 *   filter runs. The filter is unchanged and still decides.
                 */
                const missingIds = matchingMemberIds.filter(
                    (id) => !applications.some(app => app.id === id),
                );
                if (missingIds.length > 0) {
                    const extra = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where(FieldPath.documentId(), "in", missingIds).get();
                    applications = applications.concat(serializeDocs(extra.docs));
                }
                const matchingMemberIdSet = new Set(matchingMemberIds);

                const s = search.toLowerCase().trim();
                applications = applications.filter(app => {
                    const shortId = `ese-coop-${app.id.slice(-4).toLowerCase()}`;
                    const docSearchString = [
                        app.id,
                        shortId,
                        app.firstName,
                        app.lastName,
                        /*
                         *   #825 — fullName and otherNames were missing, and
                         *   they are where a LEGACY member's name lives: the
                         *   bulk import wrote one string, not a first/last
                         *   pair. This check is a SUBSTRING match, so it is
                         *   also the only thing that finds a surname sitting in
                         *   the middle of a combined name — the query layer
                         *   offers prefix ranges and no `like`, so
                         *   "ELEDUMARE" cannot be found in "NGOZI ELEDUMARE"
                         *   by the database. Within the page it is found here.
                         *   Beyond the page it is not findable at all, and that
                         *   bound is recorded rather than papered over.
                         */
                        app.fullName,
                        app.otherNames,
                        app.phone,
                        app.email
                    ].filter(Boolean).map(String).join(" ").toLowerCase();
                    return docSearchString.includes(s)
                        || matchingUserIdsSet.has(app.userId)
                        //   #825 — found by a name field the string above does
                        //   not join (fullName, otherNames). Fetching the right
                        //   document and then discarding it is no better than
                        //   never fetching it.
                        || matchingMemberIdSet.has(app.id);
                });
            }

            // Apply registry filter if active
            if (registry === "legacy") {
                applications = applications.filter(app => app.isLegacy === true);
            } else if (registry === "regular") {
                applications = applications.filter(app => app.isLegacy !== true);
            }

            // Apply state filter if active
            if (state) {
                const cleanState = state.toLowerCase().replace(/\s*state$/i, "").trim();
                applications = applications.filter(app => {
                    const stateOfOrigin = app.stateOfOrigin || "";
                    const cleanStateOfOrigin = typeof stateOfOrigin === 'string'
                        ? stateOfOrigin.toLowerCase().replace(/\s*state$/i, "").trim()
                        : "";
                    return cleanStateOfOrigin.includes(cleanState);
                });
            }

            // Apply LGA filter if active
            if (lga) {
                const cleanLga = lga.toLowerCase().trim();
                applications = applications.filter(app => {
                    const appLga = app.lga || "";
                    return typeof appLga === 'string' && appLga.toLowerCase().includes(cleanLga);
                });
            }

            // Calculate stats on the cohort before applying status/payment filters
            const pendingCount = applications.filter(app => app.membershipStatus === "pending").length;
            const approvedCount = applications.filter(app => app.membershipStatus === "approved" || app.membershipStatus === "active").length;
            const paidCount = applications.filter(app => app.paymentStatus === "completed").length;
            const unpaidCount = applications.filter(app => app.paymentStatus !== "completed").length;
            stats = {
                pendingMembers: pendingCount,
                activeMembers: approvedCount,
                paidMembers: paidCount,
                unpaidMembers: unpaidCount,
                totalMembers: applications.length
            };

            // Now apply status and payment filters to get the final list for display
            if (statusFilter && statusFilter !== "all") {
                if (statusFilter === "approved" || statusFilter === "active") {
                    applications = applications.filter(app => app.membershipStatus === "approved" || app.membershipStatus === "active");
                } else {
                    applications = applications.filter(app => app.membershipStatus === statusFilter);
                }
            }

            if (paymentFilter && paymentFilter !== "all") {
                if (paymentFilter === "completed") {
                    applications = applications.filter(app => app.paymentStatus === "completed");
                } else if (paymentFilter === "unpaid" || paymentFilter === "pending") {
                    applications = applications.filter(app => app.paymentStatus === "pending" || app.paymentStatus === "unpaid" || app.paymentStatus === "failed");
                } else {
                    applications = applications.filter(app => app.paymentStatus === paymentFilter);
                }
            }
        }

        let page = 0;
        const pageOption = (options as any).page;
        if (pageOption !== undefined) {
            page = Number(pageOption);
        } else if (cursorId && /^\d+$/.test(cursorId)) {
            page = Number(cursorId);
        }

        const offset = page * limitCount;
        const paged = useMemoryPagination ? applications.slice(offset, offset + limitCount) : applications;
        const _hasMore = useMemoryPagination 
            ? (offset + limitCount < applications.length)
            : hasMoreRaw;

        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : undefined)
            : (_hasMore ? nextCursor : undefined);

        let standardForms: any[] = [];
        if ((options.sortBy === "gender" || options.sortBy === "state")) {
            const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
            const userMap = new Map<string, any>();
            const userPromises = [];
            for (let i = 0; i < userIds.length; i += 30) {
                const chunk = userIds.slice(i, i + 30);
                if (chunk.length > 0) {
                    userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
                }
            }
            const userSnapsArray = await Promise.all(userPromises);
            /*
             *   #903 THE RAW USER DOCUMENT WENT STRAIGHT TO THE BROWSER, AND
             *   THE SCREEN REPORTED A REACT ERROR INSTEAD OF A LIST.
             *
             *   THE OWNER: "Membership applications could not be loaded.
             *   Minified React error #441."
             *
             *   #441 is the RSC client's "an error occurred in the Server
             *   Components render", whose text production strips. It is NOT
             *   this action failing: every read here is inside a try/catch that
             *   returns the sentence "Failed to load cooperative members", and
             *   that sentence is not what the owner saw. The throw happens
             *   AFTER the return, while React serialises the payload — which is
             *   why the handler below cannot catch it and why the message
             *   arrives with no detail.
             *
             *   firestore-serialize's own header says what does that: "Server
             *   Actions CANNOT pass class instances (like Firestore Timestamps)
             *   to Client Components." The member rows were already serialised —
             *   `serializeDocs(snapshot.docs)` above — but the USER documents
             *   fetched to fill in the blanks were not, and `mergedData` reads
             *   `uData.dateOfBirth || uData.dob` and `uData.bankDetails`
             *   straight out of them into what is returned. A member whose user
             *   record carries a Timestamp date of birth put a Timestamp in the
             *   response, and the whole page failed rather than that one field.
             *
             *   THE SAME RULE, APPLIED TO ONE OF THE THREE PLACES IT NAMES. The
             *   sibling action at the top of this very file already writes
             *   `serializeValue(d.data())` into its user map. Two hydration
             *   loops in this action — the gender sort and the default page —
             *   did not, and the default page is the one that opens on arrival.
             */
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));
            const siblingMap = await siblingMemberRowsByUserId(userIds);

            const mapped = applications.map((app: any) => {
                const uData = (userMap.get(app.userId as string) || {}) as any;

                //   The member's OTHER membership row, where the onboarding
                //   form's answers are if this row was written by the payment.
                //   See lib/cooperative-member-identity.ts — nothing is written
                //   and no field the row already has can be displaced.
                const siblings = (siblingMap.get(app.userId as string) || [])
                    .filter((r: any) => r.id !== app.id);
                const sibling = pickDetailRow(app, siblings);

                const mergedData = mergeMemberIdentity(app, uData, sibling);

                const localName = mergedData.firstName
                    ? joinFullName(namePartsOf(mergedData)).trim()
                    : (mergedData.fullName || null);
                const userName = uData.firstName
                    ? joinFullName(namePartsOf(uData)).trim()
                    : (uData.fullName || uData.name || uData.displayName || localName || "");

                const bankDetails = uData.bankDetails || {
                    bankName: app.bankName || uData.bankName || uData.bankAccount?.bankName || "",
                    accountNumber: app.accountNumber || uData.bankAccountNumber || uData.bankAccount?.accountNumber || "",
                    accountName: app.accountName || uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? joinFullName(namePartsOf(uData)) : ""),
                    bankCode: app.bankCode || uData.bankCode || uData.bankAccount?.bankCode || ""
                };

                return {
                    id: app.id,
                    user: {
                        id: app.userId,
                        name: userName,
                        email: mergedData.email || "",
                        phone: mergedData.phone || "",
                        dob: mergedData.dateOfBirth || "",
                        address: mergedData.residentialAddress || "",
                        state: mergedData.stateOfOrigin || "",
                        lga: mergedData.lga || "",
                        ward: mergedData.ward || "",
                        gender: mergedData.gender || "",
                        bankDetails
                    },
                    status: app.membershipStatus || "pending",
                    /**
                     *   #338 THE STRIP WRITTEN FOR RAW-DOCUMENT SPREADS WAS NOT
                     *        APPLIED TO THIS ONE.
                     *
                     *        `...mergedData` is the whole COOPERATIVE_MEMBERS
                     *        document merged with the user document, and
                     *        `bankDetails` is then re-attached beside it with
                     *        the account number in the clear. It is rendered
                     *        field-by-field by DynamicDetailModal, whose
                     *        exclude list covers bvnVerified/bvnStatus but not
                     *        `bvn` itself — so the number was displayed.
                     *
                     *        The gate above is isAdmin(), which is true for all
                     *        TEN admin roles. That is #152's finding on a
                     *        different screen: the fix there added a maySeePii
                     *        gate to admin/_users.ts, and lib/admin-pii.ts was
                     *        written for exactly this case — its own header
                     *        says "several of those lists also spread a raw
                     *        user or registration document into the response
                     *        ... This is the strip for those spreads." It was
                     *        applied to three sites and missed here.
                     *
                     *        Gated on the permission the screen exists to
                     *        exercise, matching _withdrawals.ts and
                     *        _marketplace.ts: an admin who may approve members
                     *        sees what they need to approve one; the rest get
                     *        the record with the identity and bank keys removed
                     *        at any depth.
                     */
                    data: maySeeMemberPii
                        ? { ...mergedData, bankDetails }
                        : stripPii({ ...mergedData, bankDetails })
                };
            });

            // Sort by gender in-memory
            const order = options.sortOrder || "desc";
            //   Typed `any` because mergeMemberIdentity returns a
            //   Record rather than a literal, and an object spread of a
            //   Record drops its index signature — so `data.createdAt`,
            //   which is read here, stops resolving.
            const byState = options.sortBy === "state";
            mapped.sort((a: any, b: any) => {
                //   STATE collapses "Unknown" to blank and files blanks last;
                //   GENDER is left exactly as it was — see lib/admin-row-sort.
                const ga = byState ? adminSortKey(a.user?.state) : (a.user?.gender || "").toLowerCase();
                const gb = byState ? adminSortKey(b.user?.state) : (b.user?.gender || "").toLowerCase();
                if (byState && !ga !== !gb) return ga ? -1 : 1;
                if (ga === gb) {
                    const aTime = a.data?.createdAt?.seconds ? a.data.createdAt.seconds * 1000 : new Date(a.data?.createdAt || 0).getTime();
                    const bTime = b.data?.createdAt?.seconds ? b.data.createdAt.seconds * 1000 : new Date(b.data?.createdAt || 0).getTime();
                    return bTime - aTime;
                }
                return order === "asc" ? ga.localeCompare(gb) : gb.localeCompare(ga);
            });

            standardForms = mapped.slice(offset, offset + limitCount);
        } else {
            const userIds = [...new Set(paged.map(app => app.userId).filter(Boolean))];
            const userMap = new Map<string, any>();
            const userPromises = [];
            for (let i = 0; i < userIds.length; i += 30) {
                const chunk = userIds.slice(i, i + 30);
                if (chunk.length > 0) {
                    userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
                }
            }
            const userSnapsArray = await Promise.all(userPromises);
            //   #903 — see the note on the sibling loop above. This is the
            //   loop the DEFAULT page load runs.
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeValue(d.data()))));
            const siblingMap = await siblingMemberRowsByUserId(userIds);

            standardForms = paged.map((app: any) => {
                const uData = (userMap.get(app.userId as string) || {}) as any;

                //   The member's OTHER membership row, where the onboarding
                //   form's answers are if this row was written by the payment.
                //   See lib/cooperative-member-identity.ts — nothing is written
                //   and no field the row already has can be displaced.
                const siblings = (siblingMap.get(app.userId as string) || [])
                    .filter((r: any) => r.id !== app.id);
                const sibling = pickDetailRow(app, siblings);

                const mergedData = mergeMemberIdentity(app, uData, sibling);

                const localName = mergedData.firstName
                    ? joinFullName(namePartsOf(mergedData)).trim()
                    : (mergedData.fullName || null);
                const userName = uData.firstName
                    ? joinFullName(namePartsOf(uData)).trim()
                    : (uData.fullName || uData.name || uData.displayName || localName || "");

                const bankDetails = uData.bankDetails || {
                    bankName: app.bankName || uData.bankName || uData.bankAccount?.bankName || "",
                    accountNumber: app.accountNumber || uData.bankAccountNumber || uData.bankAccount?.accountNumber || "",
                    accountName: app.accountName || uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? joinFullName(namePartsOf(uData)) : ""),
                    bankCode: app.bankCode || uData.bankCode || uData.bankAccount?.bankCode || ""
                };

                return {
                    id: app.id,
                    user: {
                        id: app.userId,
                        name: userName,
                        email: mergedData.email || "",
                        phone: mergedData.phone || "",
                        dob: mergedData.dateOfBirth || "",
                        address: mergedData.residentialAddress || "",
                        state: mergedData.stateOfOrigin || "",
                        lga: mergedData.lga || "",
                        ward: mergedData.ward || "",
                        gender: mergedData.gender || "",
                        bankDetails
                    },
                    status: app.membershipStatus || "pending",
                    data: {
                        ...mergedData,
                        bankDetails
                    }
                };
            });
        }

        // A COHORT CAPPED AT 5,000 REPORTED ITSELF AS COMPLETE.
        //
        // Any filtered view — a search, a date range, a state, an LGA, a
        // registry, or a gender sort — switches to in-memory pagination and
        // fetches fetchLimit + 1 rows. `hasMoreRaw` records whether that cap was
        // reached, and then the memory branch computed _hasMore purely from the
        // length of what it had:
        //
        //     offset + limitCount < applications.length
        //
        // So on a cooperative larger than the cap, an admin paged to the end of
        // the first 5,000, was told there was no more, and never saw the rest —
        // and the cohort `stats` beside the list counted only those 5,000 while
        // presenting as the whole cohort.
        //
        // Reported rather than silently paged past, the same way the loans
        // export and the cooperative financial totals now report theirs.
        const cohortTruncated = useMemoryPagination && hasMoreRaw;
        if (cohortTruncated) {
            logger.error(
                `[getStandardCooperativeMembers] the filtered cohort hit the ${fetchLimit}-row cap — `
                + `the list AND the stats beside it are INCOMPLETE. Narrow the filters.`,
                { adminScope, statusFilter, paymentFilter }
            );
        }

        return paginatedOk(
            standardForms,
            _nextCursor,
            {
                ...(stats ? { stats } : {}),
                truncated: cohortTruncated,
                rowCap: fetchLimit,
            },
        );
    } catch (error) {
        logger.error(`getStandardCooperativeMembersAction error:`, error);
        return paginatedErr("Failed to load cooperative members");
    }
}
