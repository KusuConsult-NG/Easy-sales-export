/**
 * Admin Broadcast — Server Actions
 *
 * Powers the admin broadcast email feature:
 *  - Fetches filtered users from Firestore
 *  - Fans out via Resend (batched, max 50 per request)
 *  - Persists a log to `broadcast_logs` collection
 */

"use server";

import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { sendEmailNotification, sendBatchEmailNotifications } from "@/lib/email-notifications";
import { FieldValue } from "firebase-admin/firestore";

// ── Types ──────────────────────────────────────────────────────────────────

export type BroadcastAudience =
    | "all"
    | "buyers"
    | "sellers"
    | "marketplace_onboarded"
    | "cooperative_members"
    | "wave_applicants"
    | "wave_briefing_registrants"
    | "wholesale_sellers"
    | "retail_sellers";

export interface BroadcastFilters {
    audience: BroadcastAudience;
    state?: string; // e.g. 'Lagos'
    sellerStatus?: "pending" | "approved" | "suspended"; // only for seller audiences
}

export interface BroadcastLog {
    id: string;
    subject: string;
    body: string;
    audience: BroadcastAudience;
    filters: BroadcastFilters;
    sentBy: string;
    sentByName: string;
    sentAt: Date | string;
    totalRecipients: number;
    successCount: number;
    failCount: number;
    status: "sending" | "done" | "partial";
}

export interface BroadcastPreviewResult {
    count: number;
    sample: { name: string; email: string }[];
    error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Delay ms between Resend batches to stay within rate limits */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build branded HTML email from plain subject + body text.
 * Body supports simple line-breaks.
 */
function buildEmailHtml(subject: string, body: string, recipientEmail?: string): string {
    const htmlBody = body
        .split("\n")
        .map((line) => (line.trim() === "" ? "<br/>" : `<p style="margin:0 0 12px">${line}</p>`))
        .join("");

    const unsubscribeFooter = recipientEmail 
        ? `<p style="font-size:12px;color:#9ca3af;margin:16px 0 0;text-align:center"><a href="mailto:unsubscribe@easysalesexport.com?subject=unsubscribe%20${encodeURIComponent(recipientEmail)}" style="color:#9ca3af;text-decoration:underline">Unsubscribe from these emails</a></p>`
        : "";

    return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
      <div style="background:#16a34a;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">Easy Sales Export</h1>
        <p style="color:#bbf7d0;margin:4px 0 0;font-size:13px">Nigeria's Premier Agricultural Platform</p>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:32px">
        <h2 style="font-size:20px;color:#111827;margin:0 0 20px">${subject}</h2>
        <div style="font-size:15px;color:#374151;line-height:1.7">${htmlBody}</div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0"/>
        <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center">
          Easy Sales Export · <a href="https://easysalesexport.com" style="color:#16a34a">easysalesexport.com</a>
        </p>
        ${unsubscribeFooter}
      </div>
    </div>`;
}

/** Collect recipients based on audience filter — returns unique email list */
async function collectRecipients(
    filters: BroadcastFilters
): Promise<{ name: string; email: string }[]> {
    console.log("[Broadcast] collectRecipients called with filters:", JSON.stringify(filters));
    const db = getAdminDb();
    console.log("[Broadcast] getAdminDb() succeeded");
    const recipients: Map<string, { name: string; email: string }> = new Map();

    const add = (email: string, name: string) => {
        if (email && !recipients.has(email)) recipients.set(email, { name, email });
    };

    switch (filters.audience) {
        case "all": {
            console.log(`[Broadcast] Querying collection: '${COLLECTIONS.USERS}'`);
            const snap = await db.collection(COLLECTIONS.USERS).get();
            console.log(`[Broadcast] 'all' audience: ${snap.size} docs found in '${COLLECTIONS.USERS}'`);
            snap.forEach((d: FirebaseFirestore.QueryDocumentSnapshot) => {
                const u = d.data();
                if (filters.state && u.state !== filters.state) return;
                const resolvedEmail = u.email || u.emailAddress;
                const resolvedName = u.fullName || u.name || u.displayName || "User";
                if (!resolvedEmail) {
                    console.log(`[Broadcast] Skipping user doc ${d.id} — no email field`);
                }
                add(resolvedEmail, resolvedName);
            });
            break;
        }
        case "buyers": {
            const snap = await db
                .collection(COLLECTIONS.USERS)
                .where("marketplaceAccountType", "in", ["buyer", "both"])
                .get();
            snap.forEach((d: FirebaseFirestore.QueryDocumentSnapshot) => {
                const u = d.data();
                if (filters.state && u.state !== filters.state) return;
                add(u.email || u.emailAddress, u.name || u.displayName || "User");
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
                // Resolve email from users collection
                const userSnap = await db.collection(COLLECTIONS.USERS).doc(v.userId).get();
                const u = userSnap.data();
                if (u) add(u.email || u.emailAddress, u.name || u.displayName || "Seller");
            }
            break;
        }
        case "marketplace_onboarded": {
            const snap = await db
                .collection(COLLECTIONS.USERS)
                .where("marketplaceAccountType", "in", ["buyer", "seller", "both"])
                .get();
            snap.forEach((d: FirebaseFirestore.QueryDocumentSnapshot) => {
                const u = d.data();
                if (filters.state && u.state !== filters.state) return;
                add(u.email || u.emailAddress, u.name || u.displayName || "User");
            });
            break;
        }
        case "cooperative_members": {
            const snap = await db
                .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("status", "==", "active")
                .get();
            for (const d of snap.docs) {
                const m = d.data();
                if (m.email) add(m.email, m.name || "Member");
            }
            break;
        }
        case "wave_applicants": {
            const snap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).get();
            for (const d of snap.docs) {
                const a = d.data();
                const applicantEmail = a.email || a.userEmail;
                if (applicantEmail) add(applicantEmail, a.name || `${a.firstName || ''} ${a.surname || ''}`.trim() || "Applicant");
            }
            break;
        }
        case "wave_briefing_registrants": {
            const snap = await db
                .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                .where("status", "==", "registered")
                .get();
            for (const d of snap.docs) {
                const r = d.data();
                const regEmail = r.email || r.userEmail;
                if (regEmail) add(regEmail, r.name || `${r.firstName || ''} ${r.surname || ''}`.trim() || "Registrant");
            }
            break;
        }
    }

    const result = Array.from(recipients.values());
    console.log(`[Broadcast] collectRecipients returning ${result.length} recipients`);
    return result;
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Preview — returns estimated recipient count + a 3-user sample (no emails sent)
 */
export async function previewBroadcastAction(
    filters: BroadcastFilters
): Promise<BroadcastPreviewResult> {
    try {
        console.log("[Broadcast] previewBroadcastAction called");
        const recipients = await collectRecipients(filters);
        console.log(`[Broadcast] preview result: ${recipients.length} recipients`);
        return {
            count: recipients.length,
            sample: recipients.slice(0, 3),
        };
    } catch (error: any) {
        console.error("[Broadcast] previewBroadcastAction ERROR:", error);
        return { count: 0, sample: [], error: error.message };
    }
}

/**
 * Send — fans out to all recipients in 50-at-a-time batches via Resend,
 * then writes a BroadcastLog to Firestore.
 */
export async function sendBroadcastAction(
    filters: BroadcastFilters,
    subject: string,
    body: string
): Promise<{ success: boolean; sent: number; failed: number; logId?: string; error?: string }> {
    try {
        const recipients = await collectRecipients(filters);
        if (recipients.length === 0) {
            return { success: false, sent: 0, failed: 0, error: "No recipients matched the selected filters." };
        }

        // --- NEW: Filter out bounced emails ---
        const bouncedEmailsSnap = await getAdminDb().collection(COLLECTIONS.BOUNCED_EMAILS).get();
        const bouncedEmailsSet = new Set(bouncedEmailsSnap.docs.map(doc => doc.id.toLowerCase()));
        
        const validRecipients = recipients.filter(r => {
            const normalizedEmail = r.email.toLowerCase().replace(/\//g, "_");
            return !bouncedEmailsSet.has(normalizedEmail) && !bouncedEmailsSet.has(r.email.toLowerCase());
        });

        if (validRecipients.length === 0) {
            return { success: false, sent: 0, failed: 0, error: "All matched recipients have previously bounced or complained." };
        }
        // --------------------------------------

        let successCount = 0;
        let failCount = 0;
        let excludedCount = recipients.length - validRecipients.length;

        // Chunk into batches of 100 (Resend batch API limit is 100 emails per request)
        const BATCH = 100;
        for (let i = 0; i < validRecipients.length; i += BATCH) {
            const chunk = validRecipients.slice(i, i + BATCH);
            
            // Map the chunk to the batch payload format
            const payload = chunk.map(r => ({
                to: r.email,
                subject,
                message: buildEmailHtml(subject, body, r.email),
                metadata: { type: "admin_broadcast" },
                headers: {
                    "List-Unsubscribe": `<mailto:unsubscribe@easysalesexport.com?subject=unsubscribe%20${encodeURIComponent(r.email)}>`,
                    "Precedence": "bulk"
                }
            }));

            // Dispatch 100 emails in a single HTTP request
            const res = await sendBatchEmailNotifications(payload);

            if (res.success) {
                 successCount += chunk.length;
            } else {
                failCount += chunk.length;
                console.error("Batch failure:", res.error);
                // Can't log individual sync bounce blocks for massive batches easily,
                // but Async webhooks will still catch any bounces perfectly.
            }

            // throttle slightly between giant batches
            if (i + BATCH < validRecipients.length) await sleep(500);
        }

        const status: BroadcastLog["status"] =
            failCount === 0 ? "done" : successCount === 0 ? "partial" : "partial";

        // Persist to Firestore
        const logRef = await getAdminDb().collection(COLLECTIONS.BROADCAST_LOGS).add({
            subject,
            body,
            audience: filters.audience,
            filters,
            sentBy: "admin",
            sentByName: "Admin",
            sentAt: FieldValue.serverTimestamp(),
            totalRecipients: recipients.length,
            successCount,
            failCount,
            status,
        });

        return { success: true, sent: successCount, failed: failCount, logId: logRef.id };
    } catch (error: any) {
        return { success: false, sent: 0, failed: 0, error: error.message };
    }
}

/**
 * Fetch broadcast history (last 50 broadcasts, newest first)
 */
export async function getBroadcastHistoryAction(): Promise<{ logs: BroadcastLog[]; error?: string }> {
    try {
        const snap = await getAdminDb()
            .collection(COLLECTIONS.BROADCAST_LOGS)
            .orderBy("sentAt", "desc")
            .limit(50)
            .get();

        const logs: BroadcastLog[] = snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => {
            const data = d.data();
            return {
                id: d.id,
                subject: data.subject,
                body: data.body,
                audience: data.audience,
                filters: data.filters,
                sentBy: data.sentBy,
                sentByName: data.sentByName,
                sentAt: data.sentAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                totalRecipients: data.totalRecipients,
                successCount: data.successCount,
                failCount: data.failCount,
                status: data.status,
            } as BroadcastLog;
        });

        return { logs };
    } catch (error: any) {
        return { logs: [], error: error.message };
    }
}
