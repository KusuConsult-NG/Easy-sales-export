/**
 * SMS Broadcast — Server Action
 *
 * Sends bulk SMS messages to targeted audiences using the Termii client.
 * Phone numbers are extracted from the users collection, falling back to
 * module sub-collections (academy_applications, cooperative_members,
 * wave_applications) when no phone is found on the root user document.
 *
 * Rate: Messages are sent in batches of 10 with a 1-second pause between
 * batches to avoid overwhelming the Termii API.
 */

"use server";

import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { sendSMS } from "@/lib/termii";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "@/lib/require-admin";
import { ActionResponse } from "@/lib/safe-action";
import { logger } from "@/lib/logger";

function isStateMatch(dbState: any, filterState: string | undefined): boolean { if (!filterState) return true;
    if (!dbState || typeof dbState !== 'string') return false;
    return dbState.toLowerCase().includes(filterState.toLowerCase()); }

// ── Types ──────────────────────────────────────────────────────────────────

export type SmsAudience =
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
    | "abandoned_failed_transactions"
    | "custom";

export interface SmsFilters { audience: SmsAudience;
    state?: string;
    sellerStatus?: "all" | "pending" | "approved" | "suspended";
    moduleStatus?: string;
    customRecipients?: string[]; }

export type SmsBroadcastPreview = ActionResponse<{
    count: number;
    sample: { name: string; phone: string }[];
}>;

export type SmsBroadcastResult = ActionResponse<{
    sent: number;
    failed: number;
    skipped: number;
    logId?: string;
}>;

// ── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalisePhone(raw: string | undefined | null): string | null { if (!raw) return null;
    let p = String(raw).replace(/\D/g, "");
    if (p.startsWith("0")) p = "234" + p.slice(1);
    if (p.length < 10) return null;
    return p; }

async function resolveUsers(db: FirebaseFirestore.Firestore, userIds: string[]) {
    const compact = Array.from(new Set(userIds.filter(id => id && typeof id === 'string' && id.trim().length > 0)));
    const map = new Map<string, any>();
    for (let i = 0; i < compact.length; i += 100) {
        const batchIds = compact.slice(i, i + 100);
        const batchRefs = batchIds.map((id) => db.collection(COLLECTIONS.USERS).doc(id));
        if (batchRefs.length === 0) continue;
        try {
            const snaps = await db.getAll(...batchRefs);
            for (const snap of snaps) {
                if (snap.exists) map.set(snap.id, snap.data());
            }
        } catch (err) {
            logger.error(`[SmsBroadcast] Failed to resolve users batch ${i}-${i + 100}`, err);
        }
    }
    return map;
}

/** Collect recipient phone numbers based on audience filter */
async function collectSmsRecipients(
    filters: SmsFilters
): Promise<{ name: string; phone: string }[]> { const db = getAdminDb();
    const recipients: Map<string, { name: string; phone: string }> = new Map();

    const add = (rawPhone: string | undefined | null, name: string) => { const phone = normalisePhone(rawPhone);
        if (phone && !recipients.has(phone)) recipients.set(phone, { name, phone });
    };

    switch (filters.audience) { // ─────────────────────────────────────────────────────────────────
        // ALL USERS — harvest from main `users` collection PLUS supplement
        // from every module sub-collection for users whose phone was never
        // synced to their root profile (legacy data gap).
        // ─────────────────────────────────────────────────────────────────
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
            const usersStream = db.collection(COLLECTIONS.USERS).select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "kyc", "fullName", "name").get();
            const seenUserIds = new Set<string>();
            for (const d of (await usersStream).docs) {
                if (excludeIds.has(d.id)) continue;
                const u: any = d.data();
                seenUserIds.add(u.id || d.id);
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(u.phone || u.phoneNumber || (u.kyc && u.kyc.phoneNumber), u.fullName || u.name || "User");
            }

            // 2. Supplement: cooperative_members (phone may be stored here only)
            const cmStream = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).select("userId", "state", "address", "phone", "phoneNumber", "firstName", "lastName").get();
            for (const d of (await cmStream).docs) { const m: any = d.data();
                const uid = m.userId || d.id;
                if (excludeIds.has(uid)) continue;
                const userState = m.state || (m.address && m.address.state);
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                const phone = m.phone || m.phoneNumber;
                const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || "Member";
                add(phone, name);
            }

            // 3. Supplement: wave_applications
            const waveStream = db.collection(COLLECTIONS.WAVE_APPLICATIONS).select("userId", "state", "residentialState", "phone", "alternativePhone", "phoneNumber", "firstName", "surname", "lastName").get();
            for (const d of (await waveStream).docs) { const a: any = d.data();
                const uid = a.userId || d.id;
                if (excludeIds.has(uid)) continue;
                if (filters.state && !isStateMatch(a.state, filters.state) && !isStateMatch(a.residentialState, filters.state)) continue;
                const phone = a.phone || a.alternativePhone || a.phoneNumber;
                const name = [a.firstName, a.surname || a.lastName].filter(Boolean).join(" ") || "Applicant";
                add(phone, name);
            }

            // 4. Supplement: academy_applications
            const academyStream = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).select("userId", "personalInfo", "state", "phone", "phoneNumber").get();
            for (const d of (await academyStream).docs) { const a: any = d.data();
                const uid = a.userId || d.id;
                if (excludeIds.has(uid)) continue;
                const userState = (a.personalInfo && a.personalInfo.state) || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                const phone = (a.personalInfo && a.personalInfo.phone) || a.phone || a.phoneNumber;
                const name = (a.personalInfo && a.personalInfo.fullName) || [a.personalInfo && a.personalInfo.firstName, a.personalInfo && a.personalInfo.lastName].filter(Boolean).join(" ") || "Academy User";
                add(phone, name);
            }

            // 5. Supplement: wave_briefing_registrations
            const briefStream = db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS).select("userId", "state", "phone", "phoneNumber", "name", "firstName", "surname").get();
            for (const d of (await briefStream).docs) { const r: any = d.data();
                const uid = r.userId || d.id;
                if (excludeIds.has(uid)) continue;
                if (filters.state && !isStateMatch(r.state, filters.state)) continue;
                add(r.phone || r.phoneNumber, r.name || [r.firstName, r.surname].filter(Boolean).join(" ") || "Registrant");
            }

            // 6. Supplement: farm_nation_applications
            const fnStream = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).select("profile").get();
            for (const d of (await fnStream).docs) { const a: any = d.data();
                if (filters.state && !isStateMatch(a.profile?.state, filters.state)) continue;
                add(a.profile?.phone, a.profile?.fullName || [a.profile?.firstName, a.profile?.lastName].filter(Boolean).join(" ") || "Farm Nation User");
            }

            // 7. Supplement: export_onboarding_applications
            const exportStream = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).select("profile", "companyInfo", "state", "phone", "phoneNumber").get();
            for (const d of (await exportStream).docs) { const a: any = d.data();
                const userState = (a.profile && a.profile.state) || (a.companyInfo && a.companyInfo.state) || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add((a.profile && a.profile.phone) || a.phone || a.phoneNumber, (a.profile && a.profile.fullName) || "Export User");
            }

            break;
        }
        case "buyers": { const stream = db
                .collection(COLLECTIONS.USERS)
                .where("marketplaceAccountType", "in", ["buyer", "both"])
                .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "fullName", "name")
                .get();
            for (const d of (await stream).docs) {
                const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(u.phone || u.phoneNumber, u.fullName || u.name || "User");
            }
            break;
        }
        case "sellers":
        case "wholesale_sellers":
        case "retail_sellers": { let q: FirebaseFirestore.Query = db
                .collection(COLLECTIONS.SELLER_VERIFICATIONS);
            if (filters.sellerStatus && filters.sellerStatus !== "all") {
                q = q.where("status", "==", filters.sellerStatus);
            }
            if (filters.audience === "wholesale_sellers") q = q.where("sellerCategory", "==", "wholesale");
            if (filters.audience === "retail_sellers") q = q.where("sellerCategory", "==", "retail");
            
            const sellerStream = q.select("userId", "address").get();
            const userIds: string[] = [];
            for (const d of (await sellerStream).docs) {
                const v: any = d.data();
                if (filters.state && (!(v.address) || !isStateMatch(v.address.state, filters.state))) continue;
                if (v.userId) userIds.push(v.userId);
            }
            
            const uMap = await resolveUsers(db, userIds);
            for (const userId of userIds) { const u = uMap.get(userId);
                if (u) add(u.phone || u.phoneNumber, u.fullName || u.name || "Seller");
            }
            break;
        }
        case "marketplace_onboarded": { 
            const stream = db.collection(COLLECTIONS.USERS)
                .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "fullName", "name", "marketplaceAccountType", "roles", "serviceRegistrations")
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

                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(u.phone || u.phoneNumber, u.fullName || u.name || "User");
            }
            break;
        }
        case "cooperative_members": { 
            const stream = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).select("userId", "state", "address", "phone", "phoneNumber", "firstName", "lastName", "name", "membershipStatus", "status").get();
            const userIds: string[] = [];
            const members: any[] = [];
            for (const d of (await stream).docs) {
                const m: any = d.data();
                const currentStatus = m.membershipStatus || m.status || "pending";
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

                members.push(m);
                if (m.userId) userIds.push(m.userId);
            }
            
            const uMap = await resolveUsers(db, userIds);
            for (const m of members) {
                let userState = m.state || (m.address && m.address.state);
                const uData = m.userId ? uMap.get(m.userId) : null;
                
                if (!userState && uData) userState = uData.state;

                if (filters.state && !isStateMatch(userState, filters.state)) continue;

                // Prefer phone from the member doc, fall back to user profile
                const phone = m.phone || m.phoneNumber || (uData ? uData.phone || uData.phoneNumber : null);
                const name = m.firstName ? `${m.firstName} ${m.lastName || ""}`.trim() : (uData ? uData.fullName || uData.name : "Member") || "Member";

                if (phone) add(phone, name);
            }
            break;
        }
        case "wave_applicants": {
            const stream = db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .select("state", "residentialState", "phone", "alternativePhone", "phoneNumber", "firstName", "surname", "lastName", "name", "status")
                .get();
            for (const d of (await stream).docs) {
                const a: any = d.data();
                
                let currentStatus = a.status || "pending";
                if (currentStatus === "under_review" || currentStatus === "submitted" || currentStatus === "pending_review") currentStatus = "pending";

                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    if (filters.moduleStatus === "not_approved" && (currentStatus === "approved" || currentStatus === "active")) continue;
                    else if (filters.moduleStatus === "approved" && currentStatus !== "approved" && currentStatus !== "active") continue;
                    else if (filters.moduleStatus !== "not_approved" && filters.moduleStatus !== "approved" && currentStatus !== filters.moduleStatus) continue;
                }

                if (filters.state && !isStateMatch(a.state, filters.state) && !isStateMatch(a.residentialState, filters.state)) continue;
                add(a.phone || a.alternativePhone || a.phoneNumber, `${a.firstName || ""} ${a.surname || a.lastName || ""}`.trim() || a.name || "Applicant");
            }
            break;
        }
        case "academy_users": { // Primary: academy_applications collection
            const stream = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .select("personalInfo", "state", "phone", "phoneNumber", "status", "paymentStatus")
                .get();
            for (const d of (await stream).docs) {
                const a: any = d.data();
                
                let currentStatus = a.status || "pending";
                if (currentStatus === "under_review" || currentStatus === "submitted" || currentStatus === "pending_review") currentStatus = "pending";
                
                if (currentStatus !== "approved" && !["completed", "paid", "successful"].includes(a.paymentStatus)) {
                    continue; // Skip unpaid Academy applications
                }

                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    if (filters.moduleStatus === "not_approved" && (currentStatus === "approved" || currentStatus === "active")) continue;
                    else if (filters.moduleStatus === "approved" && currentStatus !== "approved" && currentStatus !== "active") continue;
                    else if (filters.moduleStatus !== "not_approved" && filters.moduleStatus !== "approved" && currentStatus !== filters.moduleStatus) continue;
                }

                const userState = (a.personalInfo && a.personalInfo.state) || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add((a.personalInfo && a.personalInfo.phone) || a.phone || a.phoneNumber, (a.personalInfo && a.personalInfo.fullName) || [a.personalInfo && a.personalInfo.firstName, a.personalInfo && a.personalInfo.lastName].filter(Boolean).join(" ") || "Academy User");
            }

            // Supplement: users with academy_participant role (enrolled but no standalone application doc)
            const usersStream = db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "academy_participant")
                .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "kyc", "fullName", "name")
                .get();
            for (const d of (await usersStream).docs) { const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(u.phone || u.phoneNumber || (u.kyc && u.kyc.phoneNumber), u.fullName || u.name || "Academy User");
            }

            // Supplement: processedPayments for academy registration
            const ppStream = db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("type", "==", "academy_registration")
                .select("phone", "customerPhone", "customerName", "fullName")
                .get();
            for (const d of (await ppStream).docs) { const p: any = d.data();
                add(p.phone || p.customerPhone, p.customerName || p.fullName || "Academy User");
            }
            break;
        }
        case "export_users": { 
            const stream = db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .select("profile", "companyInfo", "state", "phone", "phoneNumber", "status")
                .get();
            for (const d of (await stream).docs) {
                const a: any = d.data();
                
                let currentStatus = a.status || "pending";
                if (currentStatus === "under_review" || currentStatus === "submitted" || currentStatus === "pending_review") currentStatus = "pending";

                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    if (filters.moduleStatus === "not_approved" && (currentStatus === "approved" || currentStatus === "active")) continue;
                    else if (filters.moduleStatus === "approved" && currentStatus !== "approved" && currentStatus !== "active") continue;
                    else if (filters.moduleStatus !== "not_approved" && filters.moduleStatus !== "approved" && currentStatus !== filters.moduleStatus) continue;
                }

                const userState = (a.profile && a.profile.state) || (a.companyInfo && a.companyInfo.state) || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add((a.profile && a.profile.phone) || a.phone || a.phoneNumber, (a.profile && a.profile.fullName) || "Export User");
            }

            // Supplement: users with export roles
            const usersStream = db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "export_member")
                .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "kyc", "fullName", "name")
                .get();
            for (const d of (await usersStream).docs) { const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                add(u.phone || u.phoneNumber || (u.kyc && u.kyc.phoneNumber), u.fullName || u.name || "Export User");
            }
            break;
        }
        case "farm_nation_users": {
            const stream = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .select("profile", "status")
                .get();
            for (const d of (await stream).docs) {
                const a: any = d.data();
                
                let currentStatus = a.status || "pending";
                if (currentStatus === "under_review" || currentStatus === "submitted" || currentStatus === "pending_review") currentStatus = "pending";

                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    if (filters.moduleStatus === "not_approved" && (currentStatus === "approved" || currentStatus === "active")) continue;
                    else if (filters.moduleStatus === "approved" && currentStatus !== "approved" && currentStatus !== "active") continue;
                    else if (filters.moduleStatus !== "not_approved" && filters.moduleStatus !== "approved" && currentStatus !== filters.moduleStatus) continue;
                }

                if (filters.state && !isStateMatch(a.profile?.state, filters.state)) continue;
                add(a.profile?.phone, a.profile?.fullName || `${a.profile?.firstName || ""} ${a.profile?.lastName || ""}`.trim() || "Farm Nation User");
            }

            // Supplement: processedPayments for farm_nation
            const ppStream = db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("type", "==", "farm_nation")
                .select("phone", "customerPhone", "customerName")
                .get();
            for (const d of (await ppStream).docs) { const p: any = d.data();
                add(p.phone || p.customerPhone, p.customerName || "Farm Nation User");
            }
            break;
        }
        case "abandoned_failed_transactions": { const stream = db.collection(COLLECTIONS.FAILED_PAYMENTS).select("userId", "customerPhone", "phone", "customerName").get();
            const userIds: string[] = [];
            const failedPayments: any[] = [];
            for (const d of (await stream).docs) {
                const f: any = d.data();
                failedPayments.push(f);
                if (f.userId) userIds.push(f.userId);
            }
            
            const uMap = await resolveUsers(db, userIds);
            for (const f of failedPayments) { const phone = f.customerPhone || f.phone;
                const name = f.customerName || "User";
                if (phone) {
                    add(phone, name);
                    continue;
                }
                if (!f.userId) continue;
                const u = uMap.get(f.userId);
                if (!u) continue;
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                if (u.phone || u.phoneNumber) { add(u.phone || u.phoneNumber, f.customerName || u.fullName || u.name || "User");
                }
            }
            break;
        }
        case "unpaid_applicants": { // Cross-module: everyone with paymentStatus "pending", "unpaid", or "failed".
            const [coopSnap, acadSnap] = await Promise.all([
                db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("paymentStatus", "in", ["pending", "unpaid", "failed"])
                    .select("userId", "state", "address", "phone", "phoneNumber", "firstName", "lastName", "fullName")
                    .get(),
                db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where("paymentStatus", "in", ["pending", "unpaid", "failed"])
                    .select("personalInfo", "phone", "phoneNumber", "userId")
                    .get(),
            ]);

            // Cooperative unpaid members
            const coopUserIds: string[] = [];
            const coopMembers: any[] = [];
            for (const d of coopSnap.docs) {
                const m: any = d.data();
                coopMembers.push(m);
                if (m.userId) coopUserIds.push(m.userId);
            }
            const coopUserMap = await resolveUsers(db, coopUserIds);
            for (const m of coopMembers) {
                let userState = m.state || (m.address && m.address.state);
                const uData = m.userId ? coopUserMap.get(m.userId) : null;
                if (!userState && uData) userState = uData.stateOfOrigin || uData.state || uData.address?.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                const phone = m.phone || m.phoneNumber || uData?.phone || uData?.phoneNumber;
                const name = m.fullName || `${m.firstName || ''} ${m.lastName || ''}`.trim() || uData?.fullName || uData?.name || "Cooperative User";
                if (phone) add(phone, name);
            }

            // Academy unpaid applicants
            for (const d of acadSnap.docs) {
                const a: any = d.data();
                const pi = a.personalInfo || {};
                const userState = pi.state || pi.stateOfOrigin || a.state;
                if (filters.state && !isStateMatch(userState, filters.state)) continue;
                const phone = pi.phone || a.phone || a.phoneNumber;
                if (phone) add(phone, pi.fullName || `${pi.firstName || ''} ${pi.lastName || ''}`.trim() || "Academy User");
            }
            break;
        }
        case "wave_briefing_registrants": {
            const stream = db
                .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                .where("status", "==", "registered")
                .select("state", "phone", "phoneNumber", "name", "firstName", "surname")
                .get();
            for (const d of (await stream).docs) {
                const r: any = d.data();
                if (filters.state && !isStateMatch(r.state, filters.state)) continue;
                add(r.phone || r.phoneNumber, r.name || `${r.firstName || ""} ${r.surname || ""}`.trim() || "Registrant");
            }
            break;
        }
        case "custom": { if (filters.customRecipients && Array.isArray(filters.customRecipients)) {
                filters.customRecipients.forEach(phone => {
                    add(phone, "Custom User");
                });
            }
            break;
        }
    }

    return Array.from(recipients.values());
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Preview — returns estimated recipient phone count + 3-user sample (no SMS sent)
 */
export async function previewSmsBroadcastAction(
    filters: SmsFilters
): Promise<SmsBroadcastPreview> { const authCheck = await requireAdmin();
    if ("error" in authCheck) return { success: false, error: "Unauthorized: admin role required", data: null };
    try { const recipients = await collectSmsRecipients(filters);
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
 * Send — fans out to all matched recipients in batches via Termii,
 * then writes a log to the `sms_broadcast_logs` collection.
 */
export async function sendSmsBroadcastAction(
    filters: SmsFilters,
    message: string
): Promise<SmsBroadcastResult> { const authCheck = await requireAdmin();
    if ("error" in authCheck) return { success: false, error: "Unauthorized: admin role required", data: null };
    try { const recipients = await collectSmsRecipients(filters);
        if (recipients.length === 0) {
            return { success: false, error: "No recipients with valid phone numbers matched your filters.", data: null };
        }

        let sent = 0;
        let failed = 0;
        const skipped = 0;

        // Send in batches of 10 with a 1s pause between batches
        const BATCH = 10;
        for (let i = 0; i < recipients.length; i += BATCH) { const chunk = recipients.slice(i, i + BATCH);
            const results = await Promise.allSettled(
                chunk.map((r) => sendSMS(r.phone, message))
            );
            results.forEach((result) => {
                if (result.status === "fulfilled" && result.value.success) sent++;
                else failed++;
            });
            if (i + BATCH < recipients.length) await sleep(1000);
        }

        // Persist broadcast log
        const db = getAdminDb();
        const logRef = await db.collection("sms_broadcast_logs").add({ message,
            audience: filters.audience,
            filters,
            sentBy: "admin",
            sentAt: FieldValue.serverTimestamp(),
            totalRecipients: recipients.length,
            sent,
            failed,
            skipped,
            status: failed === 0 ? "done" : sent === 0 ? "failed" : "partial" });

        return { success: true, error: null, data: { sent, failed, skipped, logId: logRef.id } };
    } catch (error: any) { return { success: false, error: error.message, data: null };
    }
}
