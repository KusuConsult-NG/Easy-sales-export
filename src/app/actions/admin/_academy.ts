"use server";

import { UNKNOWN_DATE_ISO, dateRangeEnd, dateRangeStart } from "@/lib/date-utils";
import { adminSortKey } from "@/lib/admin-row-sort";
import { notifyMemberDecision } from "@/lib/member-decision-notice";
import { html } from "@/lib/utils";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { revalidatePath, updateTag } from 'next/cache';
import { invalidateAdminGlobalStats, invalidateServiceCache } from "@/lib/cache-invalidation";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { academyGrantFields } from "@/lib/academy-entitlement";
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { moduleGrantRoles } from "@/lib/module-grant-roles";
import { sendEmailNotification } from "@/lib/email-notifications";
import { ownedProfileIdsFor, filterByOwner } from "@/lib/owned-profile-ids";

// ============================================
// Academy Application Management (Admin)
// ============================================

async function _getAcademyApplicationsAction(options: {
    limit?: number;
    search?: string;
    statusFilter?: "pending" | "under_review" | "approved" | "rejected" | "all";
    lastDocId?: string;
    sortBy?: "createdAt" | "gender" | "state";
    sortOrder?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string;
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "academy:approve_applications")) {
            const roles = session.user.roles || [];
            const hasAcademyAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "academy_admin");
            if (!hasAcademyAccess) {
                return { error: "Unauthorized: Permission required", success: false as const, data: null };
            }
        }

        const useMemoryPagination = !!options.search || !!options.dateFrom || !!options.dateTo || (options.sortBy === "gender" || options.sortBy === "state");
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);

        let q: any = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS);

        if (options.statusFilter && options.statusFilter !== "all") {
            q = q.where("status", "==", options.statusFilter);
        }

        if (options.dateFrom) {
            q = q.where("createdAt", ">=", dateRangeStart(options.dateFrom));
        }
        if (options.dateTo) {
            q = q.where("createdAt", "<=", dateRangeEnd(options.dateTo));
        }

        const orderDirection = options.sortOrder || "desc";
        q = q.orderBy("createdAt", orderDirection).limit(fetchLimit + 1);

        if (options.lastDocId && !useMemoryPagination) {
            const lastDoc = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        const snapshot = await q.get();
        let rawApplications = serializeDocs(snapshot.docs);
        
        const hasMore = rawApplications.length > fetchLimit;
        if (!useMemoryPagination) {
            rawApplications = rawApplications.slice(0, fetchLimit);
        }
        const nextCursor = rawApplications.length > 0 ? rawApplications[rawApplications.length - 1].id as string : undefined;

        let searchMatchedIds = new Set<string>();
        if (options.search) {
            /*
             *   #825 — the fifth copy of the window, and the same repair.
             *
             *   The filter further down reads `app.personalInfo?.fullName` and
             *   `app.user?.name`, which is right, but it runs over
             *   `rawApplications` — one `.limit(5000)` page ordered by
             *   createdAt descending. A student who applied before the newest
             *   five thousand was not filtered out; she was never fetched.
             *
             *   #814 fixed the Academy queue the screen calls
             *   (_ac_admin_applications). THIS reader was left, which is the
             *   shape this whole finding is about: a correct rule applied to
             *   some of the places it names. No screen calls it today; it is
             *   exported and returns applicant rows, so it is held to the same
             *   behaviour as the one that does.
             */
            const { searchDocIdsByNameFields } = await import("@/lib/admin-search-helper");
            const matchedIds = await searchDocIdsByNameFields(
                COLLECTIONS.ACADEMY_APPLICATIONS,
                ["personalInfo.surname", "personalInfo.firstName",
                 "personalInfo.otherNames", "personalInfo.fullName"],
                options.search,
            );
            searchMatchedIds = new Set(matchedIds);
            const missingIds = matchedIds.filter(
                (id) => !rawApplications.some((app: any) => app.id === id),
            );
            if (missingIds.length > 0) {
                const extra = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where(FieldPath.documentId(), "in", missingIds).get();
                rawApplications = rawApplications.concat(serializeDocs(extra.docs));
            }
        }

        // --- HYDRATION START ---
        const userIds = [...new Set(rawApplications.map((app: any) => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        const userPromises = [];
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
            }
        }
        const userSnapsArray = await Promise.all(userPromises);
        userSnapsArray.forEach(snap => snap.docs.forEach((d: any) => userMap.set(d.id, serializeValue(d.data()))));
        // --- HYDRATION END ---

        let applications = rawApplications.map((app: any) => {
            const uData = (userMap.get(app.userId as string) || {}) as any;
            const submittedRaw = app.submittedAt;
            const reviewedRaw = app.reviewedAt;

            // Canonical bankDetails
            const bankDetails = uData.bankDetails || {
                bankName: app.bankName || uData.bankName || uData.bankAccount?.bankName || "",
                accountNumber: app.accountNumber || uData.bankAccountNumber || uData.bankAccount?.accountNumber || "",
                accountName: app.accountName || uData.bankAccountName || uData.bankAccount?.accountName || uData.fullName || (uData.firstName && uData.lastName ? `${uData.firstName} ${uData.lastName}` : ""),
                bankCode: app.bankCode || uData.bankCode || uData.bankAccount?.bankCode || ""
            };

            const userName = uData.name || uData.fullName || app.personalInfo?.fullName || "Unknown Student";
            const gender = app.gender || app.personalInfo?.gender || uData.gender || app.profile?.gender || "";

            return {
                id: app.id,
                ...app,
                user: {
                    id: app.userId,
                    name: userName,
                    email: uData.email || app.personalInfo?.email || "Unknown",
                    phone: uData.phone || app.personalInfo?.phone || "Unknown",
                    gender,
                    bankDetails
                },
                // Serialize timestamps
                submittedAt: submittedRaw?.toDate
                    ? (submittedRaw.toDate() as Date).toISOString()
                    : submittedRaw instanceof Date
                        ? submittedRaw.toISOString()
                        : typeof submittedRaw === 'string' ? submittedRaw : UNKNOWN_DATE_ISO,
                reviewedAt: reviewedRaw?.toDate
                    ? (reviewedRaw.toDate() as Date).toISOString()
                    : reviewedRaw instanceof Date
                        ? reviewedRaw.toISOString()
                        : typeof reviewedRaw === 'string' ? reviewedRaw : null,
            };
        });

        // Sort in memory
        if ((options.sortBy === "gender" || options.sortBy === "state")) {
            const order = options.sortOrder || "desc";
            const byState = options.sortBy === "state";
            applications.sort((a, b) => {
                //   STATE collapses "Unknown" to blank and files blanks last;
                //   GENDER is left exactly as it was — see lib/admin-row-sort.
                const ga = byState ? adminSortKey(a.user?.state) : (a.user?.gender || "").toLowerCase();
                const gb = byState ? adminSortKey(b.user?.state) : (b.user?.gender || "").toLowerCase();
                if (byState && !ga !== !gb) return ga ? -1 : 1;
                if (ga === gb) {
                    return new Date(b.submittedAt as string).getTime() - new Date(a.submittedAt as string).getTime();
                }
                return order === "asc" ? ga.localeCompare(gb) : gb.localeCompare(ga);
            });
        } else {
            const order = options.sortOrder || "desc";
            applications.sort((a, b) => {
                const t1 = new Date(a.submittedAt as string).getTime();
                const t2 = new Date(b.submittedAt as string).getTime();
                return order === "asc" ? t1 - t2 : t2 - t1;
            });
        }

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = dateRangeStart(options.dateFrom);
            applications = applications.filter((app: any) => new Date(app.createdAt) >= from);
        }
        if (options.dateTo) {
            const to = dateRangeEnd(options.dateTo);
            applications = applications.filter((app: any) => new Date(app.createdAt) <= to);
        }

        if (options.search) {
            const s = options.search.toLowerCase().trim();
            applications = applications.filter((app: any) => {
                const searchString = [
                    app.user?.name,
                    app.user?.email,
                    app.user?.phone,
                    app.personalInfo?.fullName,
                    //   #825 — the three the database searches and this string
                    //   did not. The two lists have to agree, or a row is
                    //   fetched by one and discarded by the other. It is also a
                    //   SUBSTRING match, so it is what finds a surname sitting
                    //   in the middle of a combined name — the query layer has
                    //   prefix ranges and no `like`, so the database cannot.
                    app.personalInfo?.surname,
                    app.personalInfo?.firstName,
                    app.personalInfo?.otherNames
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s)
                    /*
                     *   AND THE DATABASE'S ANSWER STANDS ON ITS OWN.
                     *
                     *   With the lists above in agreement this is usually
                     *   redundant, which is the point: it is what stops the two
                     *   drifting apart again from silently costing a row. The
                     *   query is the authority on why a document was fetched,
                     *   and a JavaScript re-check that disagrees is wrong about
                     *   which of the two knows — the database answers "Abuba"
                     *   with ABUBAKAR through a prefix range that no substring
                     *   test reproduces.
                     */
                    || searchMatchedIds.has(app.id as string);
            });
        }

        const limit = options.limit || 50;
        let page = 0;
        const pageOption = (options as any).page;
        if (pageOption !== undefined) {
            page = Number(pageOption);
        } else if (options.lastDocId && /^\d+$/.test(options.lastDocId)) {
            page = Number(options.lastDocId);
        }

        const offset = page * limit;
        const paged = useMemoryPagination ? applications.slice(offset, offset + limit) : applications;
        const _hasMore = useMemoryPagination 
            ? (offset + limit < applications.length)
            : hasMore;

        const _nextCursor = useMemoryPagination 
            ? (_hasMore ? String(page + 1) : undefined)
            : nextCursor;

        return {
            error: null,
            success: true as const,
            data: paged,
            lastDocId: _nextCursor,
            hasMore: _hasMore,
            meta: {
                totalFetched: applications.length,
                hasMore: _hasMore
            }
        };
    } catch (error: any) {
        logger.error("Get Academy applications error:", error);
        return { error: "Failed to fetch applications", success: false as const, data: null };
    }
}

/**
 * The registration fields an admin grant writes, in the dotted form the adapter
 * flattens onto serviceRegistrations.
 *
 *   Derived from academyGrantFields rather than spelled out again, so the two
 *   doors in this file and the applications they touch cannot disagree about
 *   what a grant looks like.
 */
function academyGrantRegistration(adminUserId: string): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(academyGrantFields(adminUserId, FieldValue.serverTimestamp()))
            .map(([key, value]) => [`serviceRegistrations.academy.${key}`, value]),
    );
}

async function _approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // #277 This was a hand-written `admin | super_admin | academy_admin`
        // list. The permission matrix grants "academy:approve_applications" to
        // exactly those three roles, so this is the same answer today — stated
        // once, where a role change will be seen, instead of copied into each
        // write. getAcademyApplicationsAction at the top of this file had
        // already been converted; the three writes under it had not.
        if (!session?.user || !hasAdminPermission(session.user.roles, "academy:approve_applications")) {
            return { error: "Unauthorized: academy:approve_applications required", success: false as const };
        }

        // Get application first
        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { error: "Application not found", success: false as const };
        }

        const appData = appDoc.data()!;
        const userId = appData.userId;
        const userEmail = appData.personalInfo?.email;

        if (!userId) {
            return { error: "Application missing user ID", success: false as const };
        }

        // 1. Update Application Status
        await appRef.update({
            status: "approved",
            reviewedBy: session.user.id,
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Update User Service Registration & Role
        //
        // #277 This was `.update()`, and `update()` on a MISSING document is a
        // documented silent no-op in this adapter — see supabase-db.ts, which
        // logs a warning and affects no rows. So approving a learner with no
        // profile row flipped the application to "approved", granted no role,
        // wrote no serviceRegistrations, and returned "Academy application
        // approved successfully". The learner had no access and nothing said so.
        //
        // The orphan is not hypothetical: lib/orphaned-user-repair.ts exists for
        // it and names the cause — "users in Firebase Auth but missing Firestore
        // profile ... if registration fails between Auth creation and Firestore
        // write". Such an account can sign in and apply.
        //
        // Both sibling implementations already handled this and this one did
        // not: academy/_ac_admin_review.ts CREATES the row inside its
        // transaction, and manualAcademyEnrollmentAction below — in this very
        // file — refuses outright with "User not found". This door alone
        // reported success and did nothing.
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            // Same fields the canonical path seeds, from the application the
            // admin is approving. Without them the grant below would create a
            // profile carrying a role and no identity.
            const pi = appData.personalInfo || {};
            await userRef.set({
                uid: userId,
                email: pi.email || appData.email || "",
                fullName: pi.fullName
                    || (pi.firstName ? `${pi.firstName} ${pi.lastName || ""}`.trim() : "Learner"),
                createdAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        // set(merge) rather than update(): the write must land whether or not
        // the row existed a moment ago. The adapter flattens these to dotted
        // paths, so a sibling module's serviceRegistrations are not replaced.
        //   APPROVING AN APPLICATION IS NOT A PAYMENT, and this wrote
        //   `paymentStatus: "completed"` as though it were — with no amount, no
        //   reference and nobody recorded as having verified anything. See
        //   lib/academy-entitlement. The grant opens the module exactly as a
        //   payment does; it is simply no longer counted as one.
        await userRef.set({
            "serviceRegistrations.academy.status": "approved",
            ...academyGrantRegistration(session.user.id),
            "serviceRegistrations.academy.approvedAt": FieldValue.serverTimestamp(),
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 3. Clear Cache
        try {
            await invalidateServiceCache(userId, 'academy');
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Academy Approval] Cache clear error:', cacheError);
        }

        // 4. Send Approval Email
        if (userEmail && process.env.RESEND_API_KEY) {
            try {
                const { error } = await sendEmailNotification({
                    from: process.env.EMAIL_FROM || "Easy Sales Export Academy <info@easysalesexport.com>",
                    to: userEmail,
                    subject: "🎓 Academy Application Approved!",
                    message: html`
                        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                            <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:32px;border-radius:12px 12px 0 0;text-align:center;">
                                <h1 style="color:white;margin:0;font-size:24px;">Welcome to the Academy!</h1>
                            </div>
                            <div style="padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
                                <h2 style="color:#7c3aed;">Application Approved ✅</h2>
                                <p>Congratulations! Your application to the Easy Sales Export Academy has been <strong>approved</strong>.</p>
                                <p>You now have full access to Academy training resources, live sessions, and certification programs.</p>
                                <div style="text-align:center;margin:24px 0;">
                                    <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/academy/dashboard"
                                       style="background:#7c3aed;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">
                                        Go to Academy Dashboard
                                    </a>
                                </div>
                                <p style="color:#6b7280;font-size:14px;">Easy Sales Export Academy Team</p>
                            </div>
                        </div>
                    `,
                    metadata: { type: "academy_decision" },
                });
                if (error) {
                    logger.error("Resend API Error (Academy approval email):", error);
                }
            } catch (emailError) {
                logger.error("Failed to send Academy approval email:", emailError);
            }
        }

        // 5. Audit
        await createAdminAuditLog({
            action: "academy_approve",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
            metadata: { userId: userId },
        });

        // Revalidate
        revalidatePath("/academy", "page");
        revalidatePath("/dashboard", "page");
        updateTag(`user-status-${userId}`);

        return {
            error: null,
            success: true as const,
            message: "Academy application approved successfully",
        };
    } catch (error: any) {
        logger.error("Approve Academy application error:", error);
        return { error: "Failed to approve application", success: false as const };
    }
}

async function _rejectAcademyApplicationAction(
    applicationId: string,
    reason: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // #277 This was a hand-written `admin | super_admin | academy_admin`
        // list. The permission matrix grants "academy:approve_applications" to
        // exactly those three roles, so this is the same answer today — stated
        // once, where a role change will be seen, instead of copied into each
        // write. getAcademyApplicationsAction at the top of this file had
        // already been converted; the three writes under it had not.
        if (!session?.user || !hasAdminPermission(session.user.roles, "academy:approve_applications")) {
            return { error: "Unauthorized: academy:approve_applications required", success: false as const };
        }

        let userId: string | undefined;

        // Perform updates in a single transaction for atomicity
        await db.runTransaction(async (transaction) => {
            const appDocRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
            const appDoc = await transaction.get(appDocRef);
            if (!appDoc.exists) throw new Error("Application not found");

            const appData = appDoc.data();
            userId = appData?.userId;

            // 1. Update application status
            transaction.update(appDocRef, {
                status: "rejected",
                rejectionReason: reason,
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Update user status
            if (userId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                transaction.update(userRef, {
                    "serviceRegistrations.academy.status": "rejected",
                    // The role goes too, or the rejection revokes nothing —
                    // checkModuleAccess grants Academy from the JWT role alone.
                    // See lib/module-grant-roles.ts.
                    roles: FieldValue.arrayRemove(...moduleGrantRoles("academy")),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        });

        /*
         *   #690 AND THE APPLICANT IS TOLD, WITH THE REASON.
         *
         *   The asymmetry in this file is the whole finding in miniature:
         *   _approveAcademyApplicationAction, four hundred lines up, sends an
         *   email. This wrote `rejectionReason` — a field only an admin can
         *   read — and said nothing to the person refused.
         */
        await notifyMemberDecision({
            userId: userId ?? "",
            subject: "Your Academy application",
            outcome: "rejected",
            reason,
            link: "/academy",
            linkText: "View details",
        });

        await createAdminAuditLog({
            action: "academy_reject",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
            metadata: { reason },
        });

        // Revalidate
        revalidatePath("/academy", "page");
        revalidatePath("/dashboard", "page");
        if (userId) updateTag(`user-status-${userId}`);

        // Clear cache
        try {
            if (userId) {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(userId, 'academy');
            }
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Academy Rejection Cache] Cache clear error:', cacheError);
        }

        return {
            error: null,
            success: true as const,
            message: "Academy application rejected",
        };
    } catch (error: any) {
        logger.error("Reject Academy application error:", error);
        return { error: "Failed to reject application", success: false as const };
    }
}

// ============================================
// Mark Academy Application Under Review
// ============================================

async function _markAcademyApplicationUnderReviewAction(
    applicationId: string
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // #277 This was a hand-written `admin | super_admin | academy_admin`
        // list. The permission matrix grants "academy:approve_applications" to
        // exactly those three roles, so this is the same answer today — stated
        // once, where a role change will be seen, instead of copied into each
        // write. getAcademyApplicationsAction at the top of this file had
        // already been converted; the three writes under it had not.
        if (!session?.user || !hasAdminPermission(session.user.roles, "academy:approve_applications")) {
            return { error: "Unauthorized: academy:approve_applications required", success: false as const };
        }

        //   #612 — `update()` on a missing document is a silent no-op in the
        //   Supabase shim, so this reported success for work it did not do. The
        //   id comes from the caller and nothing established that it exists.
        const wrote = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).updateExisting({
            status: "under_review",
            reviewedBy: session.user.id,
            reviewStartedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        if (!wrote) {
            return { success: false as const, error: "That application no longer exists" };
        }

        await createAdminAuditLog({
            action: "academy_under_review",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
        });

        return {
            error: null,
            success: true as const,
            message: "Application marked as under review",
        };
    } catch (error: any) {
        logger.error("Mark Academy application under review error:", error);
        return { error: "Failed to update application status", success: false as const };
    }
}

// ============================================
// Manual Academy Enrollment (Admin)
// ============================================

async function _manualAcademyEnrollmentAction(
    userId: string,
    plan: "foundation" | "standard" | "elite"
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        // Check if admin has user update permissions (or a specific academy permission)
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return { error: "Unauthorized: Permission required - users:update", success: false as const };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false as const };
        }

        //   Manual enrolment is a grant too — see the note in the approval
        //   path above and lib/academy-entitlement.
        await userRef.update({
            "serviceRegistrations.academy.status": "active",
            "serviceRegistrations.academy.plan": plan,
            ...academyGrantRegistration(session.user.id),
            "serviceRegistrations.academy.enrolledAt": FieldValue.serverTimestamp(),
            // Ensure they have the academy role
            roles: FieldValue.arrayUnion("academy_participant"),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // ── Write/Update Application for Admin Dashboard ────────────────────────
        // Find existing applications for this user and update them, or create a mock one
        try {
            //   An admin acting on a learner acts on all of that learner's
            //   applications, not only the ones filed under the profile they
            //   last signed in as.
            const appsQuery = await filterByOwner(
                db.collection(COLLECTIONS.ACADEMY_APPLICATIONS), "userId",
                await ownedProfileIdsFor(userId))
                .get();

            if (!appsQuery.empty) {
                // Update all existing applications
                const promises = appsQuery.docs.map(doc => {
                    return db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(doc.id).update({
                        status: "approved",
                        plan: plan,
                        ...academyGrantFields(session.user.id, FieldValue.serverTimestamp()),
                        reviewedAt: FieldValue.serverTimestamp(),
                        reviewedBy: session.user.id
                    });
                });
                await Promise.all(promises);
                logger.info(`[Academy Manual Enrollment] Updated ${promises.length} existing applications to ${plan}`);
            } else {
                // Create mock application if none exists
                const mockAppRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(`manual_${userId}`);
                await mockAppRef.set({
                    applicationId: `manual_${userId}`,
                    userId: userId,
                    status: "approved",
                    plan: plan,
                    ...academyGrantFields(session.user.id, FieldValue.serverTimestamp()),
                    source: "manual_enrollment",
                    submittedAt: FieldValue.serverTimestamp(),
                    reviewedAt: FieldValue.serverTimestamp(),
                    reviewedBy: session.user.id
                }, { merge: true });
                logger.info(`[Academy Manual Enrollment] Created mock application for ${userId} with plan ${plan}`);
            }
        } catch (e) {
            logger.error("[Academy Manual Enrollment] Failed to create or update application:", e);
        }

        // CLEAR CACHE
        try {
            const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
            await invalidateServiceCache(userId, 'academy');
            logger.info(`[Academy Manual Enrollment] Cache cleared for user: ${userId}`);
        } catch (cacheError) {
            logger.error('[Academy Manual Enrollment] Cache clear error:', cacheError);
        }

        // Send Email Notification
        try {
            const userData = userDoc.data();
            const userEmail = userData?.email || userData?.emailAddress;
            const userName = userData?.name || userData?.fullName || userData?.displayName || "Student";
            if (userEmail) {
                const { sendAcademyEnrollmentEmail } = await import('@/lib/email-notifications');
                await sendAcademyEnrollmentEmail(userEmail, userName, plan);
                logger.info(`[Academy Manual Enrollment] Email sent to: ${userEmail}`);
            } else {
                logger.warn(`[Academy Manual Enrollment] Skip email: No email address for user: ${userId}`);
            }
        } catch (emailError: any) {
            logger.error(`[Academy Manual Enrollment] Failed to send email:`, emailError);
            // Non-blocking error
        }

        // Log audit
        await createAdminAuditLog({
            action: "academy_manual_enroll",
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
            metadata: { plan },
        });

        return {
            error: null,
            success: true as const,
            message: `User successfully enrolled in Academy (${plan} package)`,
        };
    } catch (error: any) {
        logger.error("Manual academy enrollment error:", error);
        return { error: "Failed to enroll user: " + error.message, success: false as const };
    }
}

export const getAcademyApplicationsAction = withFlexibleSafeAction("getAcademyApplicationsAction", _getAcademyApplicationsAction);

export const approveAcademyApplicationAction = withFlexibleSafeAction("approveAcademyApplicationAction", _approveAcademyApplicationAction);

export const rejectAcademyApplicationAction = withFlexibleSafeAction("rejectAcademyApplicationAction", _rejectAcademyApplicationAction);

export const markAcademyApplicationUnderReviewAction = withFlexibleSafeAction("markAcademyApplicationUnderReviewAction", _markAcademyApplicationUnderReviewAction);

export const manualAcademyEnrollmentAction = withFlexibleSafeAction("manualAcademyEnrollmentAction", _manualAcademyEnrollmentAction);
