/**
 * In-App Notification Broadcast — Server Action
 *
 * Sends bulk in-app notifications to targeted user audiences by writing
 * to the Firestore `notifications` collection.
 *
 * Because notifications are persisted in Firestore (not just pushed),
 * users will see them even if they were offline when the broadcast was sent.
 * The real-time NotificationCenter component listens to this collection
 * and will surface new notifications as soon as the user comes online.
 *
 * Schema: Each notification document in `notifications/{autoId}` conforms to
 * the `Notification` interface defined in @/lib/types/firestore.ts
 */

"use server";

import { getAdminDb } from "@/lib/supabase-db";
import { memberStatusOf } from "@/lib/cooperative-membership-status";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { requireAdmin } from "@/lib/require-admin";
import { ActionResponse } from "@/lib/safe-action";
import { logger } from "@/lib/logger";

function isStateMatch(dbState: any, filterState: string | undefined): boolean { if (!filterState) return true;
    if (!dbState || typeof dbState !== 'string') return false;
    return dbState.toLowerCase().includes(filterState.toLowerCase()); }

// ── Types ──────────────────────────────────────────────────────────────────

export type InAppAudience =
    | "all"
    | "all_except_approved_coop"
    | "buyers"
    | "sellers"
    | "marketplace_onboarded"
    | "cooperative_members"
    | "wave_applicants"
    | "wave_briefing_registrants"
    | "wholesale_sellers"
    | "retail_sellers"
    | "academy_users"
    | "export_users"
    | "farm_nation_users"
    | "unpaid_applicants"
    | "abandoned_failed_transactions";

import type { Notification } from "@/lib/types/firestore";
import { loadNonContactableUserIds } from "@/lib/contactable-account";
import { isMarketplaceBuyer, isApprovedModuleStatus } from "@/lib/broadcast-audience";
import { recordAdminAction } from "@/lib/audit-log";

export type NotificationType = Notification["type"];

export interface InAppBroadcastFilters { audience: InAppAudience;
    state?: string;
    sellerStatus?: "all" | "pending" | "approved" | "suspended";
    moduleStatus?: string; }

export type InAppBroadcastPreview = ActionResponse<{
    count: number;
    sample: { name: string; userId: string }[];
}>;

export type InAppBroadcastResult = ActionResponse<{
    delivered: number;
    logId?: string;
    /**
     * The value stamped on every notification this broadcast produced — #676.
     *
     * It is the log row's own id, so the row describing a send and the
     * notifications it produced are linked by construction. Previously this was
     * `BROADCAST-${Date.now()}` evaluated once PER NOTIFICATION, which gave
     * every row in one broadcast a different value and two broadcasts started
     * in the same millisecond the same one — a grouping key that grouped
     * nothing.
     */
    broadcastId?: string;
}>;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Collect unique user IDs based on audience filter */
async function resolveUsers(db: any, userIds: string[]) {
    const compact = Array.from(new Set(userIds.filter(id => id && typeof id === 'string' && id.trim().length > 0)));
    const map = new Map<string, any>();
    
    // Create chunks to respect Firestore 100-document limit
    const chunks = [];
    for (let i = 0; i < compact.length; i += 100) {
        chunks.push(compact.slice(i, i + 100));
    }

    // Process all chunks in parallel for peak performance on Railway
    await Promise.all(chunks.map(async (batchIds, index) => {
        const batchRefs = batchIds.map((id) => db.collection(COLLECTIONS.USERS).doc(id));
        if (batchRefs.length === 0) return;
        try {
            const snaps = await db.getAll(...batchRefs);
            for (const snap of snaps) {
                if (snap.exists) map.set(snap.id, snap.data());
            }
        } catch (err) {
            logger.error(`[InAppBroadcast] Failed to resolve users batch index ${index}`, err);
        }
    }));

    return map;
}

export async function collectRecipientUserIds(
    filters: InAppBroadcastFilters
): Promise<{ userId: string; name: string }[]> { const authCheck = await requireAdmin("announcements:manage");
    if ("error" in authCheck) throw new Error("Unauthorized: admin role required");
    const db = getAdminDb();
    const recipients: Map<string, { userId: string; name: string }> = new Map();

    /**
     *   #697 — the accounts the platform has tombstoned, loaded once.
     *
     *   This audience keys on the UID, so the deduplication that hides a
     *   superseded profile from the email and SMS lists does not apply: an
     *   in-app notification written onto a superseded row lands on an account
     *   #490 says is not where the person is, and one written onto an erased
     *   row lands on somebody who asked to be removed.
     */
    const notContactable = await loadNonContactableUserIds(db, COLLECTIONS.USERS);

    const add = (userId: string, name: string) => {
        if (userId && notContactable.has(userId)) return;
        if (userId && !recipients.has(userId)) recipients.set(userId, { userId, name });
    };

    switch (filters.audience) { 
        case "all": 
        case "all_except_approved_coop": {
            const excludeIds = new Set<string>();
            if (filters.audience === "all_except_approved_coop") {
                const approvedCoopSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("membershipStatus", "==", "approved").get();
                const activeCoopSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("status", "==", "approved").get();
                approvedCoopSnap.docs.forEach(doc => excludeIds.add(doc.data().userId || doc.id));
                activeCoopSnap.docs.forEach(doc => excludeIds.add(doc.data().userId || doc.id));
            }

            // 1. Primary: root users collection
            // .all(): a broadcast must reach every recipient, not the first
            // 5,000 of ~41,000.
            const stream = db.collection(COLLECTIONS.USERS)
                .select("name", "fullName", "stateOfOrigin", "state", "address")
                .all()
                .get();
            for (const d of (await stream).docs) {
                if (excludeIds.has(d.id)) continue;
                const u = d.data();
                const userState = u.stateOfOrigin || u.state || u.address?.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(d.id, u.fullName || u.name || "User");
            }

            // 2. Supplement: cooperative_members
            const cmStream = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).select("userId", "state", "address", "firstName", "lastName").get();
            for (const d of (await cmStream).docs) {
                const m = d.data();
                const uid = m.userId || d.id;
                if (excludeIds.has(uid)) continue;
                const userState = m.state || (m.address && m.address.state);
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                if (uid) add(uid, m.firstName ? `${m.firstName} ${m.lastName || ""}`.trim() : "Member");
            }

            // 3. Supplement: wave_applications
            const waveStream = db.collection(COLLECTIONS.WAVE_APPLICATIONS).select("userId", "state", "residentialState", "firstName", "surname").get();
            for (const d of (await waveStream).docs) {
                const a = d.data();
                const uid = a.userId || d.id;
                if (excludeIds.has(uid)) continue;
                if (filters.state && !isStateMatch(a.state, filters.state) && !isStateMatch(a.residentialState, filters.state)) continue;
                if (uid) add(uid, `${a.firstName || ""} ${a.surname || ""}`.trim() || "Applicant");
            }

            // 4. Supplement: academy_applications
            const academyStream = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).select("userId", "personalInfo", "state").get();
            for (const d of (await academyStream).docs) { const a = d.data();
                const uid = a.userId || d.id;
                if (excludeIds.has(uid)) continue;
                const userState = a.personalInfo?.state || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                if (uid) add(uid, a.personalInfo?.fullName || "Academy User");
            }

            // 5. Supplement: wave_briefing_registrations
            const briefStream = db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS).where("status", "==", "registered").select("userId", "name", "firstName", "surname", "state").get();
            for (const d of (await briefStream).docs) {
                const r = d.data();
                const uid = r.userId || d.id;
                if (excludeIds.has(uid)) continue;
                if (filters.state && !isStateMatch(r.state, filters.state)) continue;
                if (uid) add(uid, r.name || `${r.firstName || ""} ${r.surname || ""}`.trim() || "Registrant");
            }

            // 6. Supplement: farm_nation_applications
            const fnStream = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).select("userId", "profile").get();
            for (const d of (await fnStream).docs) {
                const a = d.data();
                const uid = a.userId || d.id;
                if (excludeIds.has(uid)) continue;
                if (filters.state && !isStateMatch(a.profile?.state, filters.state)) continue;
                if (uid) add(uid, a.profile?.fullName || `${a.profile?.firstName || ""} ${a.profile?.lastName || ""}`.trim() || "Farm Nation User");
            }

            // 7. Supplement: export_applications
            const exportStream = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).select("userId", "profile", "companyInfo", "state").get();
            for (const d of (await exportStream).docs) { const a = d.data();
                const uid = a.userId || d.id;
                if (excludeIds.has(uid)) continue;
                const userState = a.profile?.state || a.companyInfo?.state || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                if (uid) add(uid, a.profile?.fullName || "Export User");
            }

            break;
        }
        case "buyers": {
            // Same defect as sms-broadcast.ts: this queried
            // `.where("marketplaceAccountType", "in", ["buyer", "both"])` on a
            // field nothing writes, so the in-app "buyers" broadcast reached
            // nobody. See @/lib/broadcast-audience for the shared definition.
            const stream = db
                .collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "buyer")
                .select("name", "fullName", "stateOfOrigin", "state", "address", "marketplaceAccountType", "roles")
                .get();
            for (const d of (await stream).docs) {
                const u = d.data();
                if (!isMarketplaceBuyer(u)) continue;
                const userState = u.stateOfOrigin || u.state || u.address?.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(d.id, u.fullName || u.name || "User");
            }
            break;
        }
        case "sellers":
        case "wholesale_sellers":
        case "retail_sellers": { let q: import("@/lib/supabase-db").SupabaseQuery = db
                .collection(COLLECTIONS.SELLER_VERIFICATIONS);
            if (filters.sellerStatus && filters.sellerStatus !== "all") {
                q = q.where("status", "==", filters.sellerStatus);
            }
            if (filters.audience === "wholesale_sellers") q = q.where("sellerCategory", "==", "wholesale");
            if (filters.audience === "retail_sellers") q = q.where("sellerCategory", "==", "retail");
            const snap = await q.get();
            const uMap = await resolveUsers(db, snap.docs.map(d => d.data().userId));
            for (const d of snap.docs) {
                const v = d.data();
                if (filters.state && !isStateMatch(v.address?.state, filters.state)) continue;
                const u = uMap.get(v.userId);
                if (u) add(v.userId, u.fullName || u.name || "Seller");
            }
            break;
        }
        case "marketplace_onboarded": { 
            const stream = db.collection(COLLECTIONS.USERS)
                .select("name", "fullName", "stateOfOrigin", "state", "address", "marketplaceAccountType", "roles", "serviceRegistrations")
                .stream();
            for await (const chunk of stream) {
                const d: any = chunk;
                const u: any = d.data();
                const mReg = u.serviceRegistrations?.marketplace;
                const ENROLLED_STATUSES = new Set(['pending', 'under_review', 'approved', 'active', 'paid', 'completed', 'suspended']);
                if (!((mReg && ENROLLED_STATUSES.has(mReg.status)) || u.marketplaceAccountType || (u.roles && (u.roles.includes("buyer") || u.roles.includes("seller"))))) continue;

                const userStatus = mReg?.status || "approved";
                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    if (filters.moduleStatus === "not_approved") {
                        if (userStatus === "approved" || userStatus === "active") continue;
                    } else if (filters.moduleStatus === "approved") {
                        if (userStatus !== "approved" && userStatus !== "active") continue;
                    } else {
                        if (userStatus !== filters.moduleStatus) continue;
                    }
                }

                const userState = u.stateOfOrigin || u.state || u.address?.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(d.id, u.fullName || u.name || "User");
            }
            break;
        }
        case "cooperative_members": { // We use .get() for smaller auxiliary queries but we select minimum fields
            const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .select("userId", "firstName", "lastName", "state", "address", "membershipStatus", "status", "paymentStatus")
                .get();
            const uMap = await resolveUsers(db, snap.docs.map(d => d.data().userId));
            for (const d of snap.docs) {
                const m = d.data();
                const currentStatus = memberStatusOf(m);
                if (currentStatus !== "approved" && m.paymentStatus !== "completed") {
                    continue; // Skip unpaid applications
                }
                
                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    if (filters.moduleStatus === "not_approved") {
                        if (currentStatus === "approved" || currentStatus === "active") continue;
                    } else if (filters.moduleStatus === "approved") {
                        if (currentStatus !== "approved" && currentStatus !== "active") continue;
                    } else {
                        if (currentStatus !== filters.moduleStatus) continue;
                    }
                }
                const uid = m.userId || d.id;
                
                let userState = m.state || (m.address && m.address.state);
                const uData = uid ? uMap.get(uid) : null;
                if (!userState && uData) {
                    userState = uData.state;
                }

                if (filters.state && !isStateMatch(userState, filters.state)) continue;

                add(uid, m.firstName ? `${m.firstName} ${m.lastName || ""}`.trim() : "Member");
            }
            break;
        }
        case "wave_applicants": {
            const stream = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .select("userId", "firstName", "surname", "state", "residentialState", "status")
                .get();
            for (const d of (await stream).docs) {
                const a = d.data();
                
                let currentStatus = a.status || "pending";
                if (currentStatus === "under_review" || currentStatus === "submitted" || currentStatus === "pending_review") currentStatus = "pending";

                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    // The exact complement of the "approved" arm below — see
                    // isApprovedModuleStatus. Excluding only approved and active put an
                    // applicant whose status is "paid" into BOTH audiences, and
                    // not_approved is the chase-up list.
                    if (filters.moduleStatus === "not_approved" && isApprovedModuleStatus(currentStatus)) continue;
                    else if (filters.moduleStatus === "approved" && !isApprovedModuleStatus(currentStatus)) continue;
                    else if (filters.moduleStatus !== "not_approved" && filters.moduleStatus !== "approved" && currentStatus !== filters.moduleStatus) continue;
                }

                if (filters.state && !isStateMatch(a.state, filters.state) && !isStateMatch(a.residentialState, filters.state)) continue;
                if (a.userId) add(a.userId, `${a.firstName || ""} ${a.surname || ""}`.trim() || "Applicant");
            }
            break;
        }
        case "academy_users": { 
            const stream = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .select("userId", "personalInfo", "state", "status", "paymentStatus")
                .get();
            for (const d of (await stream).docs) {
                const a = d.data();
                
                let currentStatus = a.status || "pending";
                if (currentStatus === "under_review" || currentStatus === "submitted" || currentStatus === "pending_review") currentStatus = "pending";
                
                if (currentStatus !== "approved" && !["completed", "paid", "successful"].includes(a.paymentStatus)) {
                    continue; // Skip unpaid Academy applications
                }

                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    // The exact complement of the "approved" arm below — see
                    // isApprovedModuleStatus. Excluding only approved and active put an
                    // applicant whose status is "paid" into BOTH audiences, and
                    // not_approved is the chase-up list.
                    if (filters.moduleStatus === "not_approved" && isApprovedModuleStatus(currentStatus)) continue;
                    else if (filters.moduleStatus === "approved" && !isApprovedModuleStatus(currentStatus)) continue;
                    else if (filters.moduleStatus !== "not_approved" && filters.moduleStatus !== "approved" && currentStatus !== filters.moduleStatus) continue;
                }

                const userState = a.personalInfo?.state || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                if (a.userId) add(a.userId, a.personalInfo?.fullName || "Academy User");
            }
            break;
        }
        case "export_users": { 
            const stream = db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .select("userId", "profile", "companyInfo", "state", "status")
                .get();
            for (const d of (await stream).docs) {
                const a = d.data();
                
                let currentStatus = a.status || "pending";
                if (currentStatus === "under_review" || currentStatus === "submitted" || currentStatus === "pending_review") currentStatus = "pending";

                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    // The exact complement of the "approved" arm below — see
                    // isApprovedModuleStatus. Excluding only approved and active put an
                    // applicant whose status is "paid" into BOTH audiences, and
                    // not_approved is the chase-up list.
                    if (filters.moduleStatus === "not_approved" && isApprovedModuleStatus(currentStatus)) continue;
                    else if (filters.moduleStatus === "approved" && !isApprovedModuleStatus(currentStatus)) continue;
                    else if (filters.moduleStatus !== "not_approved" && filters.moduleStatus !== "approved" && currentStatus !== filters.moduleStatus) continue;
                }

                const userState = a.profile?.state || a.companyInfo?.state || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                if (a.userId) add(a.userId, a.profile?.fullName || "Export User");
            }
            break;
        }
        case "farm_nation_users": {
            const stream = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .select("userId", "profile", "status")
                .get();
            for (const d of (await stream).docs) {
                const a = d.data();
                
                let currentStatus = a.status || "pending";
                if (currentStatus === "under_review" || currentStatus === "submitted" || currentStatus === "pending_review") currentStatus = "pending";

                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    // The exact complement of the "approved" arm below — see
                    // isApprovedModuleStatus. Excluding only approved and active put an
                    // applicant whose status is "paid" into BOTH audiences, and
                    // not_approved is the chase-up list.
                    if (filters.moduleStatus === "not_approved" && isApprovedModuleStatus(currentStatus)) continue;
                    else if (filters.moduleStatus === "approved" && !isApprovedModuleStatus(currentStatus)) continue;
                    else if (filters.moduleStatus !== "not_approved" && filters.moduleStatus !== "approved" && currentStatus !== filters.moduleStatus) continue;
                }

                if (filters.state && !isStateMatch(a.profile?.state, filters.state)) continue;
                if (a.userId) add(a.userId, a.profile?.fullName || `${a.profile?.firstName || ""} ${a.profile?.lastName || ""}`.trim() || "Farm Nation User");
            }
            break;
        }
        case "wave_briefing_registrants": {
            const stream = db
                .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                .where("status", "==", "registered")
                .select("userId", "name", "firstName", "surname", "state")
                .get();
            for (const d of (await stream).docs) {
                const r = d.data();
                if (filters.state && !isStateMatch(r.state, filters.state)) continue;
                if (r.userId) add(r.userId, r.name || `${r.firstName || ""} ${r.surname || ""}`.trim() || "Registrant");
            }
            break;
        }
        case "unpaid_applicants": { // Cross-module: everyone with paymentStatus "pending", "unpaid", or "failed".
            const [coopSnap, acadSnap] = await Promise.all([
                db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("paymentStatus", "in", ["pending", "unpaid", "failed"])
                    .select("userId", "firstName", "lastName", "fullName", "state", "address")
                    .get(),
                db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where("paymentStatus", "in", ["pending", "unpaid", "failed"])
                    .select("userId", "personalInfo", "state")
                    .get(),
            ]);

            // Cooperative unpaid members
            const coopUserIds: string[] = [];
            for (const d of coopSnap.docs) {
                const m: any = d.data();
                if (m.userId) coopUserIds.push(m.userId);
            }
            const coopUserMap = await resolveUsers(db, coopUserIds);
            for (const d of coopSnap.docs) {
                const m: any = d.data();
                if (!m.userId) continue;
                let userState = m.state || (m.address && m.address.state);
                const uData = coopUserMap.get(m.userId);
                if (!userState && uData) userState = uData.stateOfOrigin || uData.state || uData.address?.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                const name = m.fullName || `${m.firstName || ''} ${m.lastName || ''}`.trim() || uData?.fullName || uData?.name || "Cooperative User";
                add(m.userId, name);
            }

            // Academy unpaid applicants
            for (const d of acadSnap.docs) {
                const a: any = d.data();
                if (!a.userId) continue;
                const pi = a.personalInfo || {};
                const userState = pi.state || pi.stateOfOrigin || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(a.userId, pi.fullName || `${pi.firstName || ''} ${pi.lastName || ''}`.trim() || "Academy User");
            }
            break;
        }
        case "abandoned_failed_transactions": { const snap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).select("userId", "customerName").get();
            const uMap = await resolveUsers(db, snap.docs.map(d => d.data().userId));
            for (const d of snap.docs) {
                const f = d.data();
                if (!f.userId) continue;

                if (filters.state) {
                    const u = uMap.get(f.userId);
                    const userState = u?.stateOfOrigin || u?.state || u?.address?.state;
                    if (!u || !isStateMatch(userState, filters.state)) continue;
                }

                add(f.userId, f.customerName || "User");
            }
            break;
        }
    }

    return Array.from(recipients.values());
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Preview — returns estimated count + 3-user sample (no notifications created)
 */
export async function previewInAppBroadcastAction(
    filters: InAppBroadcastFilters
): Promise<InAppBroadcastPreview> { const authCheck = await requireAdmin("announcements:manage");
    if ("error" in authCheck) return { success: false, error: "Unauthorized: admin role required", data: null };
    try { const recipients = await collectRecipientUserIds(filters);
        return {
            success: true,
            error: null,
            data: {
                count: recipients.length,
                sample: recipients.slice(0, 3)
            }
        };
    } catch (error: any) { return { success: false, error: error.message, data: null };
    }
}

/**
 * Send — writes one notification document per user in batches of 500
 * (Firestore batch limit). Each document persists for offline users.
 */
export async function sendInAppBroadcastAction(
    filters: InAppBroadcastFilters,
    title: string,
    message: string,
    type: NotificationType = "info",
    link?: string,
    linkText?: string
): Promise<InAppBroadcastResult> { const authCheck = await requireAdmin("announcements:manage");
    if ("error" in authCheck) return { success: false, error: "Unauthorized: admin role required", data: null };
    const db = getAdminDb();
    /**
     *   #676 THE RECORD OF A BROADCAST WAS WRITTEN AFTER THE BROADCAST.
     *
     *        Both channels delivered first and logged second, and both catch
     *        blocks return `{ success: false, error }` having written NOTHING.
     *        So a broadcast that reached forty thousand members and then failed
     *        on the logging write left no log row, no audit row, and an error
     *        message on the admin's screen.
     *
     *        The consequence is not just a missing record. The admin is told
     *        the broadcast FAILED, so the reasonable thing to do is send it
     *        again — and sending it again delivers to everybody who already
     *        received it. On the SMS channel that is also a second charge for
     *        every message. It is #668's shape in a different channel: the one
     *        case where you must not retry was the case that told you to.
     *
     *        The row is claimed BEFORE delivery and updated after. If the
     *        process dies in between, what survives says `sending` and names
     *        the recipient count — which is exactly what somebody deciding
     *        whether to re-send needs to see.
     */
    const logRef = db.collection("inapp_broadcast_logs").doc();
    /**
     *   #676 AND ONE BROADCAST NOW HAS ONE ID.
     *
     *        `broadcastId: \`BROADCAST-${Date.now()}\`` was evaluated INSIDE
     *        the per-notification loop, so every notification in a single
     *        broadcast carried a DIFFERENT id — and two broadcasts started in
     *        the same millisecond carried the same one. The field's own comment
     *        says it exists so a notification can be traced back to the
     *        broadcast that produced it, and it could not: there was no value
     *        that identified the group.
     *
     *        The log document's own id is used, so the notifications and the
     *        row describing them are linked by construction rather than by a
     *        timestamp that had to be unique and was not.
     */
    const broadcastId = logRef.id;

    try {
        const recipients = await collectRecipientUserIds(filters);

        if (recipients.length === 0) {
            return { success: false, error: "No recipients matched the selected filters.", data: null };
        }

        await logRef.set({
            title,
            message,
            type,
            link: link || null,
            linkText: linkText || null,
            audience: filters.audience,
            filters,
            sentBy: authCheck.userId,
            broadcastId,
            totalRecipients: recipients.length,
            delivered: 0,
            status: "sending",
            startedAt: FieldValue.serverTimestamp(),
        });

        let delivered = 0;

        // Firestore batch limit is 500 writes per batch
        const BATCH_LIMIT = 500;
        for (let i = 0; i < recipients.length; i += BATCH_LIMIT) { const chunk = recipients.slice(i, i + BATCH_LIMIT);
            const batch = db.batch();
            chunk.forEach(({ userId }) => {
                const ref = db.collection(COLLECTIONS.NOTIFICATIONS).doc();
                batch.set(ref, {
                    userId,
                    type,
                    title,
                    message,
                    link: link || null,
                    linkText: linkText || null,
                    read: false,
                    //   `broadcastId` lets us track that this notification
                    //   originated from an admin broadcast — and #676 made it
                    //   capable of that. One value, computed once above, equal
                    //   to the id of the log row describing this send.
                    broadcastId,
                    createdAt: FieldValue.serverTimestamp() });
            });
            await batch.commit();
            delivered += chunk.length;
        }

        /**
         * Close the row that was claimed before delivery.
         *
         * WHICH admin, not the literal string "admin" — every row this log ever
         * wrote said `sentBy: "admin"`, so the one question a broadcast log
         * exists to answer was the one it could not. That is set above, when
         * the row is claimed; this records only what happened.
         */
        await logRef.update({
            sentAt: FieldValue.serverTimestamp(),
            delivered,
            status: "done",
        });

        // Recorded platform-wide too. Gated on requireAdmin(), so the #66
        // ratchet — which matches hasAdminPermission() — never saw this write.
        await recordAdminAction({
            action: 'broadcast_sent',
            userId: authCheck.userId,
            targetType: 'inapp_broadcast',
            targetId: logRef.id,
            metadata: { channel: 'in_app', title, type, delivered, recipients: recipients.length, filters },
        });

        return { success: true, error: null, data: { delivered, logId: logRef.id, broadcastId } };
    } catch (error: any) {
        /**
         *   #676 A FAILURE AFTER DELIVERY SAYS SO, RATHER THAN LOOKING LIKE A
         *        BROADCAST THAT NEVER HAPPENED.
         *
         *        Best-effort by design: if the database is what failed, this
         *        write fails too, and the row claimed BEFORE delivery is what
         *        survives — still reading `sending`, which is already the
         *        honest answer. Nothing here may throw, or it would replace the
         *        real error with its own.
         */
        await logRef.update({
            status: "interrupted",
            error: String(error?.message ?? error),
            interruptedAt: FieldValue.serverTimestamp(),
        }).catch(() => { /* the claimed row already says `sending` */ });

        return { success: false, error: error.message, data: null };
    }
}
