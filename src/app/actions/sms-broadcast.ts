/**
 * SMS Broadcast — Server Action
 *
 * Sends bulk SMS messages to targeted audiences using the Termii client.
 * Phone numbers are extracted from the users collection, falling back to
 * phoneNumber if phone is not set.
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
    | "retail_sellers";

export interface SmsFilters {
    audience: SmsAudience;
    state?: string;
    sellerStatus?: "pending" | "approved" | "suspended";
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
    const str = String(raw).trim().replace(/\s+/g, "");
    if (str.startsWith("+")) return str.slice(1); // +234... → 234...
    if (str.startsWith("0")) return `234${str.slice(1)}`; // 0812... → 234812...
    if (str.startsWith("234")) return str; // already E.164 without +
    return null; // unrecognised format
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
        case "all": {
            const snap = await db.collection(COLLECTIONS.USERS).get();
            snap.forEach((d) => {
                const u = d.data();
                if (filters.state && u.state !== filters.state) return;
                add(u.phone || u.phoneNumber, u.fullName || u.name || "User");
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
                add(u.phone || u.phoneNumber, u.fullName || u.name || "User");
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
            for (const d of snap.docs) {
                const v = d.data();
                if (filters.state && v.address?.state !== filters.state) continue;
                const userSnap = await db.collection(COLLECTIONS.USERS).doc(v.userId).get();
                const u = userSnap.data();
                if (u) add(u.phone || u.phoneNumber, u.fullName || u.name || "Seller");
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
                add(u.phone || u.phoneNumber, u.fullName || u.name || "User");
            });
            break;
        }
        case "cooperative_members": {
            const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get();
            for (const d of snap.docs) {
                const m = d.data();
                // Try phone directly on member doc first, then look up user
                const phone = m.phone;
                if (phone) {
                    add(phone, m.firstName ? `${m.firstName} ${m.lastName || ""}`.trim() : "Member");
                } else if (m.userId) {
                    const userSnap = await db.collection(COLLECTIONS.USERS).doc(m.userId).get();
                    const u = userSnap.data();
                    if (u) add(u.phone || u.phoneNumber, u.fullName || u.name || "Member");
                }
            }
            break;
        }
        case "wave_applicants": {
            const snap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).get();
            snap.forEach((d) => {
                const a = d.data();
                add(a.phone || a.alternativePhone, `${a.firstName || ""} ${a.surname || ""}`.trim() || "Applicant");
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
                add(r.phone, r.name || `${r.firstName || ""} ${r.surname || ""}`.trim() || "Registrant");
            });
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
        let skipped = 0;

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
