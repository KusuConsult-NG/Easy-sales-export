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
    | "retail_sellers"
    | "academy_users"
    | "export_users"
    | "farm_nation_users"
    | "pending_applicants"
    | "abandoned_failed_transactions"
    | "csv_upload";

export interface BroadcastFilters {
    audience: BroadcastAudience;
    state?: string; // e.g. 'Lagos'
    sellerStatus?: "pending" | "approved" | "suspended"; // only for seller audiences
    moduleStatus?: string; // e.g. 'pending', 'approved', 'rejected' — applied to the active module segment
    farmNationRole?: "buyer" | "seller" | "both"; // farm nation role filter
    csvEmails?: string[]; // Array of emails extracted from CSV upload
}

export interface BroadcastLog {
    id: string;
    /** 'email' | 'sms' — used to render the correct icon and field labels */
    channel: "email" | "sms";
    subject: string;        // email subject  OR  first 60 chars of SMS message
    body: string;           // full email body OR full SMS message
    audience: BroadcastAudience;
    /** May be absent on legacy documents written before filters were standardised */
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

/** Collect recipients based on audience filter — returns unique email list */
export async function collectRecipients(
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
        case "csv_upload": {
            if (filters.csvEmails && filters.csvEmails.length > 0) {
                for (const email of filters.csvEmails) {
                    add(email.trim(), "CSV User");
                }
            }
            break;
        }
        case "all": {
            console.log(`[Broadcast] Querying collection: '${COLLECTIONS.USERS}'`);
            const stream = db.collection(COLLECTIONS.USERS).select("stateOfOrigin", "state", "address", "email", "emailAddress", "fullName", "name", "displayName").get();
            for (const d of (await stream).docs) {
                const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                const resolvedEmail = u.email || u.emailAddress;
                const resolvedName = u.fullName || u.name || u.displayName || "User";
                if (!resolvedEmail) continue;
                add(resolvedEmail, resolvedName);
            }
            break;
        }
        case "buyers": {
            // Buyers can be from marketplace or farmNation in the new registry schema
            const [mktSnap, fnSnap] = await Promise.all([
                db.collection(COLLECTIONS.USERS).where("serviceRegistrations.marketplace.status", "!=", null).select("serviceRegistrations", "stateOfOrigin", "state", "address", "email", "emailAddress", "name", "displayName").get(),
                db.collection(COLLECTIONS.USERS).where("serviceRegistrations.farmNation.status", "!=", null).select("serviceRegistrations", "stateOfOrigin", "state", "address", "email", "emailAddress", "name", "displayName").get()
            ]);
            
            const processBuyerDoc = (u: any) => {
                const srv = u.serviceRegistrations || {};
                const isMktBuyer = srv.marketplace?.accountType === "buyer" || srv.marketplace?.accountType === "both";
                const isFnBuyer = srv.farmNation?.role === "buyer" || srv.farmNation?.role === "both";
                
                if (!isMktBuyer && !isFnBuyer) return;
                
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) return;
                add(u.email || u.emailAddress, u.name || u.displayName || "User");
            };
            
            mktSnap.docs.forEach(d => processBuyerDoc(d.data()));
            fnSnap.docs.forEach(d => processBuyerDoc(d.data()));
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
            
            const sellerStream = q.select("userId", "address").get();
            const userIds: string[] = [];
            const sellerDataMap = new Map<string, any>();
            for (const d of (await sellerStream).docs) {
                const v: any = d.data();
                if (filters.state && v.address && v.address.state !== filters.state) continue;
                if (v.userId) {
                    userIds.push(v.userId);
                    sellerDataMap.set(v.userId, v);
                }
            }
            
            const uMap = await resolveUsers(db, userIds);
            for (const userId of userIds) {
                const u = uMap.get(userId);
                if (u) add(u.email || u.emailAddress, u.name || u.displayName || "Seller");
            }
            break;
        }
        case "marketplace_onboarded": {
            const stream = db
                .collection(COLLECTIONS.USERS)
                .where("serviceRegistrations.marketplace.status", "!=", null)
                .select("stateOfOrigin", "state", "address", "email", "emailAddress", "name", "displayName")
                .get();
            for (const d of (await stream).docs) {
                const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                add(u.email || u.emailAddress, u.name || u.displayName || "User");
            }
            break;
        }
        case "cooperative_members": {
            // membershipStatus field is written by registerCooperativeMemberAction ('pending'/'approved').
            // Legacy joinCooperativeAction used 'status: active'. Catch both.
            const targetStatus = filters.moduleStatus || "approved";
            // Query both possible field names to handle schema evolution
            const [newSnap, legacySnap] = await Promise.all([
                db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("membershipStatus", "==", targetStatus === "active" ? "approved" : targetStatus)
                    .select("userId", "stateOfOrigin", "state", "address", "email", "name", "firstName", "lastName", "fullName")
                    .get(),
                db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("status", "==", "active")
                    .select("userId", "stateOfOrigin", "state", "address", "email", "name", "firstName", "lastName", "fullName")
                    .get(),
            ]);

            const seenIds = new Set<string>();
            const members: any[] = [];
            const userIds: string[] = [];

            for (const snap of [newSnap, legacySnap]) {
                for (const d of snap.docs) {
                    if (seenIds.has(d.id)) continue;
                    seenIds.add(d.id);
                    const m: any = { ...d.data(), _docId: d.id };
                    members.push(m);
                    if (m.userId) userIds.push(m.userId);
                }
            }

            const uMap = await resolveUsers(db, userIds);
            for (const m of members) {
                let userState = m.stateOfOrigin || m.state || (m.address && m.address.state);
                const uData = m.userId ? uMap.get(m.userId) : null;
                if (!userState && uData) userState = uData.stateOfOrigin || uData.state || uData.address?.state;
                if (filters.state && userState !== filters.state) continue;

                const memberEmail = m.email || (uData && (uData.email || uData.emailAddress));
                const memberName = m.fullName || `${m.firstName || ''} ${m.lastName || ''}`.trim() || (uData && (uData.fullName || uData.name)) || "Member";
                if (memberEmail) add(memberEmail, memberName);
            }
            break;
        }
        case "wave_applicants": {
            let waveQ: FirebaseFirestore.Query | FirebaseFirestore.CollectionReference = db.collection(COLLECTIONS.WAVE_APPLICATIONS);
            if (filters.moduleStatus && filters.moduleStatus !== "all") {
                waveQ = (waveQ as FirebaseFirestore.CollectionReference).where("status", "==", filters.moduleStatus);
            }
            const stream = (waveQ as any).select("status", "state", "stateOfResidence", "residentialState", "email", "userEmail", "name", "firstName", "surname").get();
            for (const d of (await stream).docs) {
                const a: any = d.data();
                if (filters.state && a.state !== filters.state && a.stateOfResidence !== filters.state && a.residentialState !== filters.state) continue;
                const applicantEmail = a.email || a.userEmail;
                if (applicantEmail) add(applicantEmail, a.name || `${a.firstName || ''} ${a.surname || ''}`.trim() || "Applicant");
            }
            break;
        }
        case "wave_briefing_registrants": {
            const stream = db
                .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                .where("status", "==", "registered")
                .select("state", "email", "userEmail", "name", "firstName", "surname")
                .get();
            for (const d of (await stream).docs) {
                const r: any = d.data();
                if (filters.state && r.state !== filters.state) continue;
                const regEmail = r.email || r.userEmail;
                if (regEmail) add(regEmail, r.name || `${r.firstName || ''} ${r.surname || ''}`.trim() || "Registrant");
            }
            break;
        }
        case "academy_users": {
            let acadQ: any = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS);
            if (filters.moduleStatus && filters.moduleStatus !== "all") {
                acadQ = acadQ.where("status", "==", filters.moduleStatus);
            }
            const stream = acadQ.select("status", "personalInfo", "state", "stateOfOrigin", "email", "userEmail").get();
            for (const d of (await stream).docs) {
                const a: any = d.data();
                const pi = a.personalInfo || {};
                const userState = pi.state || pi.stateOfOrigin || a.state || a.stateOfOrigin;
                if (filters.state && userState !== filters.state) continue;
                const email = pi.email || a.email || a.userEmail;
                if (email) add(email, pi.fullName || `${pi.firstName || ''} ${pi.lastName || ''}`.trim() || "Academy User");
            }
            break;
        }
        case "export_users": {
            const stream = db.collection(COLLECTIONS.USERS)
                .where("serviceRegistrations.export.status", "!=", null)
                .select("stateOfOrigin", "state", "address", "email", "emailAddress", "name", "displayName")
                .get();
            for (const d of (await stream).docs) {
                const u: any = d.data();
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                add(u.email || u.emailAddress, u.name || u.displayName || "User");
            }
            break;
        }
        case "farm_nation_users": {
            let fnQ: any = db.collection(COLLECTIONS.USERS).where("serviceRegistrations.farmNation.status", "!=", null);
            if (filters.moduleStatus && filters.moduleStatus !== "all") {
                // Can't chain != + == on different fields without composite index — filter in-memory
            }
            const stream = fnQ.select("stateOfOrigin", "state", "address", "email", "emailAddress", "name", "displayName", "fullName", "serviceRegistrations").get();
            for (const d of (await stream).docs) {
                const u: any = d.data();
                // Module status filter (in-memory to avoid composite index requirement)
                if (filters.moduleStatus && filters.moduleStatus !== "all") {
                    if (u.serviceRegistrations?.farmNation?.status !== filters.moduleStatus) continue;
                }
                // Farm Nation role filter
                if (filters.farmNationRole) {
                    const role = u.serviceRegistrations?.farmNation?.role;
                    if (role !== filters.farmNationRole && !(filters.farmNationRole === "both" && role === "both")) continue;
                }
                const userState = u.stateOfOrigin || u.state || (u.address && u.address.state);
                if (filters.state && userState !== filters.state) continue;
                add(u.email || u.emailAddress, u.fullName || u.name || u.displayName || "User");
            }
            break;
        }
        case "pending_applicants": {
            // Cross-module: everyone pending across ALL modules in a single pass.
            // Collects from: cooperative_members, wave_applications,
            // academy_applications, and farm_nation / export via users doc.
            const [coopSnap, waveSnap, acadSnap] = await Promise.all([
                db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("membershipStatus", "==", "pending")
                    .select("userId", "stateOfOrigin", "state", "address", "email", "firstName", "lastName", "fullName")
                    .get(),
                db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                    .where("status", "==", "pending")
                    .select("state", "stateOfResidence", "email", "userEmail", "firstName", "surname", "name")
                    .get(),
                db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where("status", "==", "pending")
                    .select("personalInfo", "email", "userEmail")
                    .get(),
            ]);

            // Cooperative pending members
            const coopUserIds: string[] = [];
            const coopMembers: any[] = [];
            for (const d of coopSnap.docs) {
                const m: any = d.data();
                coopMembers.push(m);
                if (m.userId) coopUserIds.push(m.userId);
            }
            const coopUserMap = await resolveUsers(db, coopUserIds);
            for (const m of coopMembers) {
                let userState = m.stateOfOrigin || m.state || m.address?.state;
                const uData = m.userId ? coopUserMap.get(m.userId) : null;
                if (!userState && uData) userState = uData.stateOfOrigin || uData.state || uData.address?.state;
                if (filters.state && userState !== filters.state) continue;
                const email = m.email || uData?.email || uData?.emailAddress;
                const name = m.fullName || `${m.firstName || ''} ${m.lastName || ''}`.trim() || uData?.fullName || uData?.name || "Cooperative Applicant";
                if (email) add(email, name);
            }

            // WAVE pending applicants
            for (const d of waveSnap.docs) {
                const a: any = d.data();
                const userState = a.state || a.stateOfResidence;
                if (filters.state && userState !== filters.state) continue;
                const email = a.email || a.userEmail;
                if (email) add(email, a.name || `${a.firstName || ''} ${a.surname || ''}`.trim() || "WAVE Applicant");
            }

            // Academy pending applicants
            for (const d of acadSnap.docs) {
                const a: any = d.data();
                const pi = a.personalInfo || {};
                const userState = pi.state || pi.stateOfOrigin || a.state;
                if (filters.state && userState !== filters.state) continue;
                const email = pi.email || a.email || a.userEmail;
                if (email) add(email, pi.fullName || `${pi.firstName || ''} ${pi.lastName || ''}`.trim() || "Academy Applicant");
            }

            // Farm Nation + Export pending (via users collection, in-memory status check)
            const serviceSnap = await db.collection(COLLECTIONS.USERS)
                .select("stateOfOrigin", "state", "address", "email", "emailAddress", "name", "fullName", "displayName", "serviceRegistrations")
                .get();
            for (const d of serviceSnap.docs) {
                const u: any = d.data();
                const srv = u.serviceRegistrations || {};
                const isPendingFN = srv.farmNation?.status === "pending";
                const isPendingEx = srv.export?.status === "pending";
                if (!isPendingFN && !isPendingEx) continue;
                const userState = u.stateOfOrigin || u.state || u.address?.state;
                if (filters.state && userState !== filters.state) continue;
                add(u.email || u.emailAddress, u.fullName || u.name || u.displayName || "Applicant");
            }
            break;
        }
        case "abandoned_failed_transactions": {
            const stream = db.collection(COLLECTIONS.FAILED_PAYMENTS).select("userId", "customerEmail", "customerName").get();
            const userIds: string[] = [];
            const failedPayments: any[] = [];
            for (const d of (await stream).docs) {
                const f: any = d.data();
                failedPayments.push(f);
                if (f.userId) userIds.push(f.userId);
            }
            
            const uMap = await resolveUsers(db, userIds);
            for (const f of failedPayments) {
                const u = f.userId ? uMap.get(f.userId) : null;
                
                if (filters.state) {
                    const userState = u ? (u.stateOfOrigin || u.state || (u.address && u.address.state)) : null;
                    if (!f.userId || !u || userState !== filters.state) continue;
                }
                
                const email = f.customerEmail;
                if (email) {
                    add(email, f.customerName || "User");
                } else if (u && (u.email || u.emailAddress)) {
                    add(u.email || u.emailAddress, u.fullName || u.name || "User");
                }
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
        const excludedCount = recipients.length - validRecipients.length;

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

        // Persist to Firestore (omit csvEmails from filters to avoid massive documents)
        const logFilters = { ...filters };
        if (logFilters.csvEmails) {
            delete logFilters.csvEmails;
        }

        const logRef = await getAdminDb().collection(COLLECTIONS.BROADCAST_LOGS).add({
            subject,
            body,
            audience: filters.audience,
            filters: logFilters,
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
 * Fetch unified broadcast history — merges Email (broadcast_logs) +
 * SMS (sms_broadcast_logs), sorted newest-first (last 100 total).
 */
export async function getBroadcastHistoryAction(): Promise<{ logs: BroadcastLog[]; error?: string }> {
    try {
        const db = getAdminDb();

        // Fetch both collections in parallel
        const [emailSnap, smsSnap] = await Promise.all([
            db.collection(COLLECTIONS.BROADCAST_LOGS)
                .orderBy("sentAt", "desc")
                .limit(50)
                .get(),
            db.collection("sms_broadcast_logs")
                .orderBy("sentAt", "desc")
                .limit(50)
                .get(),
        ]);

        // Map email logs — handles both the current schema and legacy docs
        // that used recipientCount/type instead of totalRecipients/successCount/audience/body
        const emailLogs: BroadcastLog[] = emailSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => {
            const data = d.data();
            // Legacy docs (pre-broadcast-system) stored recipientCount, no successCount/failCount/body/audience
            const recipientCount = data.recipientCount ?? 0;
            const totalRecipients = data.totalRecipients ?? recipientCount;
            const successCount    = data.successCount   ?? recipientCount; // legacy: assume all sent if no failure field
            const failCount       = data.failCount      ?? 0;
            return {
                id: d.id,
                channel: "email" as const,
                subject: data.subject ?? "(no subject)",
                body: data.body ?? "",
                // Legacy docs store a `type` field (e.g. "bulk_email") instead of audience
                audience: (data.audience ?? data.type ?? "all") as BroadcastAudience,
                filters: data.filters ?? { audience: (data.audience ?? "all") as BroadcastAudience },
                sentBy: data.sentBy ?? "admin",
                sentByName: data.sentByName ?? "Admin",
                sentAt: data.sentAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                totalRecipients,
                successCount,
                failCount,
                status: data.status ?? "done",
            };
        });

        // Map SMS logs — field names differ slightly (sent/failed vs successCount/failCount)
        const smsLogs: BroadcastLog[] = smsSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => {
            const data = d.data();
            const msgPreview = (data.message ?? "").slice(0, 60) + ((data.message ?? "").length > 60 ? "…" : "");
            const sent = data.sent ?? data.successCount ?? 0;
            const failed = data.failed ?? data.failCount ?? 0;
            const total = data.totalRecipients ?? (sent + failed);
            const status: BroadcastLog["status"] =
                failed === 0 ? "done" : sent === 0 ? "partial" : "partial";
            return {
                id: d.id,
                channel: "sms" as const,
                subject: msgPreview,          // reuse subject slot as SMS preview
                body: data.message ?? "",     // full SMS text
                audience: data.audience ?? "all",
                filters: data.filters ?? { audience: data.audience ?? "all" },
                sentBy: data.sentBy ?? "admin",
                sentByName: data.sentByName ?? "Admin",
                sentAt: data.sentAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                totalRecipients: total,
                successCount: sent,
                failCount: failed,
                status: data.status ?? status,
            };
        });

        // Merge and sort newest-first
        const logs = [...emailLogs, ...smsLogs].sort((a, b) => {
            return new Date(b.sentAt as string).getTime() - new Date(a.sentAt as string).getTime();
        });

        return { logs };
    } catch (error: any) {
        return { logs: [], error: error.message };
    }
}
