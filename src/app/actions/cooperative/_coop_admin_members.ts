"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { stripPii, stripSecrets } from "@/lib/admin-pii";
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";
import { paginatedOk, paginatedErr, PaginatedAdminResponse } from "@/lib/admin-action-response";
import { COLLECTIONS } from "@/lib/types/firestore";
import { getAdminScope, isWithinAdminScope } from "@/lib/cooperative-admin-scope";
import { createAdminAuditLog } from "@/lib/audit-log";
import { Resend } from "resend";
import { deleteCache, invalidateCooperativeCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";
import { recordAdminAction } from "@/lib/audit-log";

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
         * `roles` above is the LIVE set this action already resolves, so the
         * check below inherits that. Seventh and eighth instances of a list
         * gated more loosely than the action it feeds; see the WAVE withdrawal
         * queue for the six before them.
         */
        const maySeeBankDetails = hasAdminPermission(roles, "cooperatives:approve_members");

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

        const allMembersRaw = serializeDocs(snapshot.docs);

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

            /**
             * The hydrated `user` block gated its bankDetails; the spread
             * beside it did not. `m` is the raw cooperative member row, and
             * this function's OWN search filter twelve lines below reads
             * m.bankName, m.accountNumber, m.nin and m.bvn from it — so the
             * row demonstrably carries them, and every admin role reached
             * this list with them attached.
             *
             * The rule is already decided in this file: the member DETAIL
             * view does `maySeeBankDetails ? ... : stripPii({...})`. The list
             * is the sibling that did not get it.
             */
            return {
                ...(maySeeBankDetails ? stripSecrets(m) : stripPii(m)),
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

        let roles = session.user.roles;
        if (!hasAdminPermission(roles, "cooperatives:approve_members")) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            // The SAME question as the gate above. This asked isAdmin(), so a
            // caller the gate refused could be admitted by the stale-session
            // retry — a fallback that is wider than what it falls back from.
            if (hasAdminPermission(liveRoles, "cooperatives:approve_members")) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

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
        //
        // AND THE CHECK ITSELF DID NOT FIRE FOR MOST MEMBERS.
        //
        // It was `memberScope && memberData.cooperativeId && ... !== memberScope`.
        // The middle conjunct is falsy on a member document with no
        // cooperativeId, which collapses the condition to "allowed" — and the
        // bulk legacy import in admin/_legacy.ts, which is where most members
        // came from, writes COOPERATIVE_MEMBERS rows without one.
        //
        // Unlike the identical guard on the two withdrawal decisions, this one
        // is REACHABLE: those gate on finance:process_withdrawals, held only by
        // super_admin and admin, both of whom getAdminScope returns null for.
        // This gates on cooperatives:approve_members, which cooperative_admin
        // holds — so a genuinely scoped admin gets here, and for a
        // bulk-imported member the guard waved them through. Activating,
        // approving or suspending a member of another cooperative was the
        // exact thing the comment above says it prevents.
        //
        // isWithinAdminScope refuses an unlabelled record instead. A platform
        // admin (scope null) is unaffected.
        const memberScope = await getAdminScope(session.user.id, roles);
        if (!isWithinAdminScope(memberScope, memberData.cooperativeId)) {
            return {
                success: false as const,
                error: "Unauthorized: Cannot change membership status for another cooperative",
                data: null,
            };
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
                        fullName: userData?.fullName || `${memberData?.firstName || ''} ${memberData?.lastName || ''}`.trim() || 'Member'
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
                    // Combine initial set and update payload
                    const initialData = {
                        uid: targetUserId,
                        email: memberData?.email || "",
                        fullName: `${memberData?.firstName || ''} ${memberData?.lastName || ''}`.trim() || "Cooperative Member",
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
                const resend = new Resend(process.env.RESEND_API_KEY);
                const { error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>',
                    to: notificationInfo.email,
                    subject: '✅ Your Cooperative Membership Has Been Approved!',
                    html: `
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

        let roles = session.user.roles;
        if (!hasAdminPermission(roles, "cooperatives:approve_members")) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            // The SAME question as the gate above. This asked isAdmin(), so a
            // caller the gate refused could be admitted by the stale-session
            // retry — a fallback that is wider than what it falls back from.
            if (hasAdminPermission(liveRoles, "cooperatives:approve_members")) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: 'Admin access required', data: null };
            }
        }

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
            }

            return {
                email: memberData?.email,
                name: memberData?.firstName ? `${memberData.firstName} ${memberData.lastName || ''}`.trim() : 'Member'
            };
        })();

        // Send revision requested email (non-blocking post-commit)
        try {
            if (notificationData?.email) {
                const resend = new Resend(process.env.RESEND_API_KEY);
                const { error } = await resend.emails.send({
                    from: process.env.EMAIL_FROM || 'Easy Sales Export <info@easysalesexport.com>',
                    to: notificationData.email,
                    subject: '⚠️ Action Required: Update Your Cooperative Application',
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                            <h2 style="color:#d97706;">Application Update Requested</h2>
                            <p>Dear <strong>${notificationData.name}</strong>,</p>
                            <p>Our team has reviewed your cooperative membership application and requires some updates before it can be approved.</p>
                            <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
                                <p style="margin:0;color:#92400e;"><strong>Note from Admin:</strong><br/>${reason}</p>
                            </div>
                            <p>Please log in to update and resubmit your application.</p>
                            <div style="text-align:center;margin:24px 0;">
                                <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/cooperatives/onboarding" style="background:#7c3aed;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Update Application</a>
                            </div>
                        </div>
                    `,
                });
                if (error) {
                    logger.error("Resend API Error (Cooperative revision email):", error);
                }
            }
        } catch (emailError) {
            logger.error('Cooperative revision email failed (non-blocking):', emailError);
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
        sortBy?: "createdAt" | "gender";
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

        const useMemoryPagination = !!search || !!options.dateFrom || !!options.dateTo || !!state || !!lga || (registry && registry !== "all") || options.sortBy === "gender";
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
                const { searchUserIdsByQuery } = await import("@/lib/admin-search-helper");
                const matchingUserIds = await searchUserIdsByQuery(search);
                const matchingUserIdsSet = new Set(matchingUserIds);
                const s = search.toLowerCase().trim();
                applications = applications.filter(app => {
                    const shortId = `ese-coop-${app.id.slice(-4).toLowerCase()}`;
                    const docSearchString = [
                        app.id,
                        shortId,
                        app.firstName,
                        app.lastName,
                        app.phone,
                        app.email
                    ].filter(Boolean).map(String).join(" ").toLowerCase();
                    return docSearchString.includes(s) || matchingUserIdsSet.has(app.userId);
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
        if (options.sortBy === "gender") {
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
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, d.data())));

            const mapped = applications.map((app: any) => {
                const uData = (userMap.get(app.userId as string) || {}) as any;
                const localName = app.firstName ? `${app.firstName} ${app.lastName || ''}`.trim() : (app.fullName || null);
                const userName = uData.firstName
                    ? `${uData.firstName} ${uData.lastName || ''}`.trim()
                    : (uData.fullName || uData.name || uData.displayName || localName || "");

                const mergedData = {
                    ...app,
                    phone:               app.phone               || uData.phone              || uData.phoneNumber || null,
                    gender:              app.gender              || uData.gender             || null,
                    dateOfBirth:         app.dateOfBirth         || uData.dateOfBirth        || uData.dob        || null,
                    occupation:          app.occupation          || uData.occupation         || null,
                    stateOfOrigin:       app.stateOfOrigin       || uData.stateOfOrigin      || (typeof uData.address === 'object' ? uData.address?.state : null) || null,
                    lga:                 app.lga                 || uData.lga                || (typeof uData.address === 'object' ? uData.address?.lga   : null) || null,
                    ward:                app.ward                || uData.ward               || (typeof uData.address === 'object' ? uData.address?.ward  : null) || null,
                    residentialAddress:  app.residentialAddress  || (typeof uData.address === 'object' ? uData.address?.street : uData.address) || null,
                    firstName:           app.firstName           || uData.firstName          || null,
                    lastName:            app.lastName            || uData.lastName           || null,
                    email:               app.email               || uData.email              || uData.userEmail  || null,
                };

                const bankDetails = uData.bankDetails || {
                    bankName: app.bankName || uData.bankName || uData.bankAccount?.bankName || "",
                    accountNumber: app.accountNumber || uData.bankAccountNumber || uData.bankAccount?.accountNumber || "",
                    accountName: app.accountName || uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : ""),
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
            mapped.sort((a, b) => {
                const ga = (a.user?.gender || "").toLowerCase();
                const gb = (b.user?.gender || "").toLowerCase();
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
            userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, d.data())));

            standardForms = paged.map((app: any) => {
                const uData = (userMap.get(app.userId as string) || {}) as any;
                const localName = app.firstName ? `${app.firstName} ${app.lastName || ''}`.trim() : (app.fullName || null);
                const userName = uData.firstName
                    ? `${uData.firstName} ${uData.lastName || ''}`.trim()
                    : (uData.fullName || uData.name || uData.displayName || localName || "");

                const mergedData = {
                    ...app,
                    phone:               app.phone               || uData.phone              || uData.phoneNumber || null,
                    gender:              app.gender              || uData.gender             || null,
                    dateOfBirth:         app.dateOfBirth         || uData.dateOfBirth        || uData.dob        || null,
                    occupation:          app.occupation          || uData.occupation         || null,
                    stateOfOrigin:       app.stateOfOrigin       || uData.stateOfOrigin      || (typeof uData.address === 'object' ? uData.address?.state : null) || null,
                    lga:                 app.lga                 || uData.lga                || (typeof uData.address === 'object' ? uData.address?.lga   : null) || null,
                    ward:                app.ward                || uData.ward               || (typeof uData.address === 'object' ? uData.address?.ward  : null) || null,
                    residentialAddress:  app.residentialAddress  || (typeof uData.address === 'object' ? uData.address?.street : uData.address) || null,
                    firstName:           app.firstName           || uData.firstName          || null,
                    lastName:            app.lastName            || uData.lastName           || null,
                    email:               app.email               || uData.email              || uData.userEmail  || null,
                };

                const bankDetails = uData.bankDetails || {
                    bankName: app.bankName || uData.bankName || uData.bankAccount?.bankName || "",
                    accountNumber: app.accountNumber || uData.bankAccountNumber || uData.bankAccount?.accountNumber || "",
                    accountName: app.accountName || uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : ""),
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
