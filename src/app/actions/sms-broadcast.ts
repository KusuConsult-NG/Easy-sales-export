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

// ── Types ──────────────────────────────────────────────────────────────────

export type SmsAudience =
    | "all"
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
    | "abandoned_failed_transactions"
    | "custom";

export interface SmsFilters {
    audience: SmsAudience;
    state?: string;
    sellerStatus?: "pending" | "approved" | "suspended";
    customRecipients?: string[];
}

export interface SmsBroadcastPreview {
    count: number;
    sample: { name: string; phone: string }[];
    error?: string;
}

export interface SmsBroadcastResult {
    success: boolean;
    sent: number;
    failed: number;
    skipped: number;
    logId?: string;
    error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalisePhone(raw: string | undefined | null): string | null {
    if (!raw) return null;
    let p = String(raw).replace(/\D/g, "");
    if (p.startsWith("0")) p = "234" + p.slice(1);
    if (p.length < 10) return null;
    return p;
}

async function resolveUsers(db: FirebaseFirestore.Firestore, userIds: string[]) {
    const compact = Array.from(new Set(userIds.filter(Boolean)));
    const map = new Map<string, any>();
    for (let i = 0; i < compact.length; i += 100) {
        const batch = compact.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.USERS).doc(id));
        if (batch.length === 0) continue;
        const snaps = await db.getAll(...batch);
        for (const snap of snaps) {
            if (snap.exists) map.set(snap.id, snap.data());
        }
    }
    return map;
}

/** Collect recipient phone numbers based on audience filter */
async function collectSmsRecipients(
    filters: SmsFilters
): Promise<{ name: string; phone: string }[]> {
    const db = getAdminDb();
    const recipients: Map<string, { name: string; phone: string }> = new Map();

    const add = (rawPhone: string | undefined | null, name: string) => {
        const phone = normalisePhone(rawPhone);
        if (phone && !recipients.has(phone)) recipients.set(phone, { name, phone });
    };

    switch (filters.audience) {
        // ─────────────────────────────────────────────────────────────────
        // ALL USERS — harvest from main `users` collection PLUS supplement
        // from every module sub-collection for users whose phone was never
        // synced to their root profile (legacy data gap).
        // ─────────────────────────────────────────────────────────────────
        case "all": {
            // 1. Primary: root users collection
            const usersStream = db.collection(COLLECTIONS.USERS).select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "kyc", "fullName", "name").stream();
            const seenUserIds = new Set<string>();
            for await (const d of usersStream) {
                const u: any = d.data();
                seenUserIds.add(u.id || d.id);
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                add(u.phone || u.phoneNumber || (u.kyc && u.kyc.phoneNumber), u.fullName || u.name || "User");
            }

            // 2. Supplement: cooperative_members (phone may be stored here only)
            const cmStream = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).select("state", "address", "phone", "phoneNumber", "firstName", "lastName").stream();
            for await (const d of cmStream) {
                const m: any = d.data();
                const userState = m.state || (m.address && m.address.state);
                if (filters.state && userState !== filters.state) continue;
                const phone = m.phone || m.phoneNumber;
                const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || "Member";
                add(phone, name);
            }

            // 3. Supplement: wave_applications
            const waveStream = db.collection(COLLECTIONS.WAVE_APPLICATIONS).select("state", "residentialState", "phone", "alternativePhone", "phoneNumber", "firstName", "surname", "lastName").stream();
            for await (const d of waveStream) {
                const a: any = d.data();
                if (filters.state && a.state !== filters.state && a.residentialState !== filters.state) continue;
                const phone = a.phone || a.alternativePhone || a.phoneNumber;
                const name = [a.firstName, a.surname || a.lastName].filter(Boolean).join(" ") || "Applicant";
                add(phone, name);
            }

            // 4. Supplement: academy_applications
            const academyStream = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).select("personalInfo", "state", "phone", "phoneNumber").stream();
            for await (const d of academyStream) {
                const a: any = d.data();
                const userState = (a.personalInfo && a.personalInfo.state) || a.state;
                if (filters.state && userState !== filters.state) continue;
                const phone = (a.personalInfo && a.personalInfo.phone) || a.phone || a.phoneNumber;
                const name = (a.personalInfo && a.personalInfo.fullName) || [a.personalInfo && a.personalInfo.firstName, a.personalInfo && a.personalInfo.lastName].filter(Boolean).join(" ") || "Academy User";
                add(phone, name);
            }

            // 5. Supplement: wave_briefing_registrations
            const briefStream = db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS).select("state", "phone", "phoneNumber", "name", "firstName", "surname").stream();
            for await (const d of briefStream) {
                const r: any = d.data();
                if (filters.state && r.state !== filters.state) continue;
                add(r.phone || r.phoneNumber, r.name || [r.firstName, r.surname].filter(Boolean).join(" ") || "Registrant");
            }

            // 6. Supplement: farm_nation_inquiries
            const fnStream = db.collection(COLLECTIONS.FARM_NATION_INQUIRIES).select("state", "phone", "phoneNumber", "firstName", "lastName").stream();
            for await (const d of fnStream) {
                const a: any = d.data();
                if (filters.state && a.state !== filters.state) continue;
                add(a.phone || a.phoneNumber, [a.firstName, a.lastName].filter(Boolean).join(" ") || "Farm Nation User");
            }

            // 7. Supplement: export_onboarding_applications
            const exportStream = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).select("profile", "companyInfo", "state", "phone", "phoneNumber").stream();
            for await (const d of exportStream) {
                const a: any = d.data();
                const userState = (a.profile && a.profile.state) || (a.companyInfo && a.companyInfo.state) || a.state;
                if (filters.state && userState !== filters.state) continue;
                add((a.profile && a.profile.phone) || a.phone || a.phoneNumber, (a.profile && a.profile.fullName) || "Export User");
            }

            break;
        }
        case "buyers": {
            const stream = db
                .collection(COLLECTIONS.USERS)
                .where("marketplaceAccountType", "in", ["buyer", "both"])
                .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "fullName", "name")
                .stream();
            for await (const d of stream as any) {
                const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                add(u.phone || u.phoneNumber, u.fullName || u.name || "User");
            }
            break;
        }
        case "sellers":
        case "wholesale_sellers":
        case "retail_sellers": {
            let q: FirebaseFirestore.Query = db
                .collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("status", "==", filters.sellerStatus || "approved");
            if (filters.audience === "wholesale_sellers") q = q.where("sellerCategory", "==", "wholesale");
            if (filters.audience === "retail_sellers") q = q.where("sellerCategory", "==", "retail");
            
            const sellerStream = q.select("userId", "address").stream();
            const userIds: string[] = [];
            for await (const d of sellerStream) {
                const v: any = d.data();
                if (filters.state && v.address && v.address.state !== filters.state) continue;
                if (v.userId) userIds.push(v.userId);
            }
            
            const uMap = await resolveUsers(db, userIds);
            for (const userId of userIds) {
                const u = uMap.get(userId);
                if (u) add(u.phone || u.phoneNumber, u.fullName || u.name || "Seller");
            }
            break;
        }
        case "marketplace_onboarded": {
            const stream = db
                .collection(COLLECTIONS.USERS)
                .where("marketplaceAccountType", "in", ["buyer", "seller", "both"])
                .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "fullName", "name")
                .stream();
            for await (const d of stream as any) {
                const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                add(u.phone || u.phoneNumber, u.fullName || u.name || "User");
            }
            break;
        }
        case "cooperative_members": {
            const stream = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).select("userId", "state", "address", "phone", "phoneNumber", "firstName", "lastName", "name").stream();
            const userIds: string[] = [];
            const members: any[] = [];
            for await (const d of stream as any) {
                const m: any = d.data();
                members.push(m);
                if (m.userId) userIds.push(m.userId);
            }
            
            const uMap = await resolveUsers(db, userIds);
            for (const m of members) {
                let userState = m.state || (m.address && m.address.state);
                const uData = m.userId ? uMap.get(m.userId) : null;
                
                if (!userState && uData) userState = uData.state;

                if (filters.state && userState !== filters.state) continue;

                // Prefer phone from the member doc, fall back to user profile
                const phone = m.phone || m.phoneNumber || (uData ? uData.phone || uData.phoneNumber : null);
                const name = m.firstName ? `${m.firstName} ${m.lastName || ""}`.trim() : (uData ? uData.fullName || uData.name : "Member") || "Member";

                if (phone) add(phone, name);
            }
            break;
        }
        case "wave_applicants": {
            const stream = db.collection(COLLECTIONS.WAVE_APPLICATIONS).select("state", "residentialState", "phone", "alternativePhone", "phoneNumber", "firstName", "surname", "lastName", "name").stream();
            for await (const d of stream as any) {
                const a: any = d.data();
                if (filters.state && a.state !== filters.state && a.residentialState !== filters.state) continue;
                add(a.phone || a.alternativePhone || a.phoneNumber, `${a.firstName || ""} ${a.surname || a.lastName || ""}`.trim() || a.name || "Applicant");
            }
            break;
        }
        case "academy_users": {
            // Primary: academy_applications collection
            const stream = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).select("personalInfo", "state", "phone", "phoneNumber").stream();
            for await (const d of stream as any) {
                const a: any = d.data();
                const userState = (a.personalInfo && a.personalInfo.state) || a.state;
                if (filters.state && userState !== filters.state) continue;
                add((a.personalInfo && a.personalInfo.phone) || a.phone || a.phoneNumber, (a.personalInfo && a.personalInfo.fullName) || [a.personalInfo && a.personalInfo.firstName, a.personalInfo && a.personalInfo.lastName].filter(Boolean).join(" ") || "Academy User");
            }

            // Supplement: users with academy_participant role (enrolled but no standalone application doc)
            const usersStream = db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "academy_participant")
                .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "kyc", "fullName", "name")
                .stream();
            for await (const d of usersStream) {
                const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                add(u.phone || u.phoneNumber || (u.kyc && u.kyc.phoneNumber), u.fullName || u.name || "Academy User");
            }

            // Supplement: processedPayments for academy registration
            const ppStream = db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("type", "==", "academy_registration")
                .select("phone", "customerPhone", "customerName", "fullName")
                .stream();
            for await (const d of ppStream) {
                const p: any = d.data();
                add(p.phone || p.customerPhone, p.customerName || p.fullName || "Academy User");
            }
            break;
        }
        case "export_users": {
            const stream = db.collection(COLLECTIONS.EXPORT_APPLICATIONS).select("profile", "companyInfo", "state", "phone", "phoneNumber").stream();
            for await (const d of stream as any) {
                const a: any = d.data();
                const userState = (a.profile && a.profile.state) || (a.companyInfo && a.companyInfo.state) || a.state;
                if (filters.state && userState !== filters.state) continue;
                add((a.profile && a.profile.phone) || a.phone || a.phoneNumber, (a.profile && a.profile.fullName) || "Export User");
            }

            // Supplement: users with export roles
            const usersStream = db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "export_member")
                .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "kyc", "fullName", "name")
                .stream();
            for await (const d of usersStream) {
                const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                add(u.phone || u.phoneNumber || (u.kyc && u.kyc.phoneNumber), u.fullName || u.name || "Export User");
            }
            break;
        }
        case "farm_nation_users": {
            const stream = db.collection(COLLECTIONS.FARM_NATION_INQUIRIES).select("state", "phone", "phoneNumber", "firstName", "lastName").stream();
            for await (const d of stream as any) {
                const a: any = d.data();
                if (filters.state && a.state !== filters.state) continue;
                add(a.phone || a.phoneNumber, `${a.firstName || ""} ${a.lastName || ""}`.trim() || "Farm Nation User");
            }

            // Supplement: processedPayments for farm_nation
            const ppStream = db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("type", "==", "farm_nation")
                .select("phone", "customerPhone", "customerName")
                .stream();
            for await (const d of ppStream) {
                const p: any = d.data();
                add(p.phone || p.customerPhone, p.customerName || "Farm Nation User");
            }
            break;
        }
        case "abandoned_failed_transactions": {
            const stream = db.collection(COLLECTIONS.FAILED_PAYMENTS).select("userId", "customerPhone", "phone", "customerName").stream();
            const userIds: string[] = [];
            const failedPayments: any[] = [];
            for await (const d of stream as any) {
                const f: any = d.data();
                failedPayments.push(f);
                if (f.userId) userIds.push(f.userId);
            }
            
            const uMap = await resolveUsers(db, userIds);
            for (const f of failedPayments) {
                const phone = f.customerPhone || f.phone;
                const name = f.customerName || "User";
                if (phone) {
                    add(phone, name);
                    continue;
                }
                if (!f.userId) continue;
                const u = uMap.get(f.userId);
                if (!u) continue;
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                if (u.phone || u.phoneNumber) {
                    add(u.phone || u.phoneNumber, f.customerName || u.fullName || u.name || "User");
                }
            }
            break;
        }
        case "wave_briefing_registrants": {
            const stream = db
                .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                .where("status", "==", "registered")
                .select("state", "phone", "phoneNumber", "name", "firstName", "surname")
                .stream();
            for await (const d of stream as any) {
                const r: any = d.data();
                if (filters.state && r.state !== filters.state) continue;
                add(r.phone || r.phoneNumber, r.name || `${r.firstName || ""} ${r.surname || ""}`.trim() || "Registrant");
            }
            break;
        }
        case "custom": {
            if (filters.customRecipients && Array.isArray(filters.customRecipients)) {
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
): Promise<SmsBroadcastPreview> {
    try {
        const recipients = await collectSmsRecipients(filters);
        return {
            count: recipients.length,
            sample: recipients.slice(0, 3),
        };
    } catch (error: any) {
        return { count: 0, sample: [], error: error.message };
    }
}

/**
 * Send — fans out to all matched recipients in batches via Termii,
 * then writes a log to the `sms_broadcast_logs` collection.
 */
export async function sendSmsBroadcastAction(
    filters: SmsFilters,
    message: string
): Promise<SmsBroadcastResult> {
    try {
        const recipients = await collectSmsRecipients(filters);
        if (recipients.length === 0) {
            return { success: false, sent: 0, failed: 0, skipped: 0, error: "No recipients with valid phone numbers matched your filters." };
        }

        let sent = 0;
        let failed = 0;
        const skipped = 0;

        // Send in batches of 10 with a 1s pause between batches
        const BATCH = 10;
        for (let i = 0; i < recipients.length; i += BATCH) {
            const chunk = recipients.slice(i, i + BATCH);
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
        const logRef = await db.collection("sms_broadcast_logs").add({
            message,
            audience: filters.audience,
            filters,
            sentBy: "admin",
            sentAt: FieldValue.serverTimestamp(),
            totalRecipients: recipients.length,
            sent,
            failed,
            skipped,
            status: failed === 0 ? "done" : sent === 0 ? "failed" : "partial",
        });

        return { success: true, sent, failed, skipped, logId: logRef.id };
    } catch (error: any) {
        return { success: false, sent: 0, failed: 0, skipped: 0, error: error.message };
    }
}
