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

import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

// ── Types ──────────────────────────────────────────────────────────────────

export type InAppAudience =
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
    | "abandoned_failed_transactions";

import type { Notification } from "@/lib/types/firestore";

export type NotificationType = Notification["type"];

export interface InAppBroadcastFilters {
    audience: InAppAudience;
    state?: string;
    sellerStatus?: "pending" | "approved" | "suspended";
}

export interface InAppBroadcastPreview {
    count: number;
    sample: { name: string; userId: string }[];
    error?: string;
}

export interface InAppBroadcastResult {
    success: boolean;
    delivered: number;
    logId?: string;
    error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Collect unique user IDs based on audience filter */
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

export async function collectRecipientUserIds(
    filters: InAppBroadcastFilters
): Promise<{ userId: string; name: string }[]> {
    const db = getAdminDb();
    const recipients: Map<string, { userId: string; name: string }> = new Map();

    const add = (userId: string, name: string) => {
        if (userId && !recipients.has(userId)) recipients.set(userId, { userId, name });
    };

    switch (filters.audience) {
        case "all": {
            const snap = await db.collection(COLLECTIONS.USERS).get();
            snap.forEach((d) => {
                const u = d.data();
                if (filters.state && u.state !== filters.state) return;
                add(d.id, u.fullName || u.name || "User");
            });
            break;
        }
        case "buyers": {
            const snap = await db
                .collection(COLLECTIONS.USERS)
                .where("marketplaceAccountType", "in", ["buyer", "both"])
                .get();
            snap.forEach((d) => {
                const u = d.data();
                if (filters.state && u.state !== filters.state) return;
                add(d.id, u.fullName || u.name || "User");
            });
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
            const snap = await q.get();
            const uMap = await resolveUsers(db, snap.docs.map(d => d.data().userId));
            for (const d of snap.docs) {
                const v = d.data();
                if (filters.state && v.address?.state !== filters.state) continue;
                const u = uMap.get(v.userId);
                if (u) add(v.userId, u.fullName || u.name || "Seller");
            }
            break;
        }
        case "marketplace_onboarded": {
            const snap = await db
                .collection(COLLECTIONS.USERS)
                .where("marketplaceAccountType", "in", ["buyer", "seller", "both"])
                .get();
            snap.forEach((d) => {
                const u = d.data();
                if (filters.state && u.state !== filters.state) return;
                add(d.id, u.fullName || u.name || "User");
            });
            break;
        }
        case "cooperative_members": {
            const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get();
            const uMap = await resolveUsers(db, snap.docs.map(d => d.data().userId));
            for (const d of snap.docs) {
                const m = d.data();
                const uid = m.userId || d.id;
                
                let userState = m.state || (m.address && m.address.state);
                const uData = uid ? uMap.get(uid) : null;
                if (!userState && uData) {
                    userState = uData.state;
                }

                if (filters.state && userState !== filters.state) continue;

                add(uid, m.firstName ? `${m.firstName} ${m.lastName || ""}`.trim() : "Member");
            }
            break;
        }
        case "wave_applicants": {
            const snap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).get();
            snap.forEach((d) => {
                const a = d.data();
                if (filters.state && a.state !== filters.state && a.residentialState !== filters.state) return;
                if (a.userId) add(a.userId, `${a.firstName || ""} ${a.surname || ""}`.trim() || "Applicant");
            });
            break;
        }
        case "academy_users": {
            const snap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).get();
            snap.forEach((d) => {
                const a = d.data();
                const userState = a.personalInfo?.state || a.state;
                if (filters.state && userState !== filters.state) return;
                if (a.userId) add(a.userId, a.personalInfo?.fullName || "Academy User");
            });
            break;
        }
        case "export_users": {
            const snap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).get();
            snap.forEach((d) => {
                const a = d.data();
                const userState = a.profile?.state || a.companyInfo?.state || a.state;
                if (filters.state && userState !== filters.state) return;
                if (a.userId) add(a.userId, a.profile?.fullName || "Export User");
            });
            break;
        }
        case "farm_nation_users": {
            const snap = await db.collection(COLLECTIONS.FARM_NATION_INQUIRIES).get();
            snap.forEach((d) => {
                const a = d.data();
                if (filters.state && a.state !== filters.state) return;
                if (a.userId) add(a.userId, `${a.firstName || ""} ${a.lastName || ""}`.trim() || "Farm Nation User");
            });
            break;
        }
        case "wave_briefing_registrants": {
            const snap = await db
                .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                .where("status", "==", "registered")
                .get();
            snap.forEach((d) => {
                const r = d.data();
                if (filters.state && r.state !== filters.state) return;
                if (r.userId) add(r.userId, r.name || `${r.firstName || ""} ${r.surname || ""}`.trim() || "Registrant");
            });
            break;
        }
        case "abandoned_failed_transactions": {
            const snap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).get();
            const uMap = await resolveUsers(db, snap.docs.map(d => d.data().userId));
            for (const d of snap.docs) {
                const f = d.data();
                if (!f.userId) continue;

                if (filters.state) {
                    const u = uMap.get(f.userId);
                    if (!u || u.state !== filters.state) continue;
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
): Promise<InAppBroadcastPreview> {
    try {
        const recipients = await collectRecipientUserIds(filters);
        return {
            count: recipients.length,
            sample: recipients.slice(0, 3),
        };
    } catch (error: any) {
        return { count: 0, sample: [], error: error.message };
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
): Promise<InAppBroadcastResult> {
    try {
        const db = getAdminDb();
        const recipients = await collectRecipientUserIds(filters);

        if (recipients.length === 0) {
            return { success: false, delivered: 0, error: "No recipients matched the selected filters." };
        }

        let delivered = 0;

        // Firestore batch limit is 500 writes per batch
        const BATCH_LIMIT = 500;
        for (let i = 0; i < recipients.length; i += BATCH_LIMIT) {
            const chunk = recipients.slice(i, i + BATCH_LIMIT);
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
                    // `broadcastId` lets us track that this notification originated from an admin broadcast
                    broadcastId: `BROADCAST-${Date.now()}`,
                    createdAt: FieldValue.serverTimestamp(),
                });
            });
            await batch.commit();
            delivered += chunk.length;
        }

        // Write a log entry
        const logRef = await db.collection("inapp_broadcast_logs").add({
            title,
            message,
            type,
            link: link || null,
            linkText: linkText || null,
            audience: filters.audience,
            filters,
            sentBy: "admin",
            sentAt: FieldValue.serverTimestamp(),
            totalRecipients: recipients.length,
            delivered,
            status: "done",
        });

        return { success: true, delivered, logId: logRef.id };
    } catch (error: any) {
        return { success: false, delivered: 0, error: error.message };
    }
}
