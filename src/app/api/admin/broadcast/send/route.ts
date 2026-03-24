/**
 * POST /api/admin/broadcast/send
 *
 * Long-running API route for sending broadcast emails.
 * Uses maxDuration = 300 (Pro plan) to avoid timeout on large audiences.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { sendBatchEmailNotifications } from "@/lib/email-notifications";
import { FieldValue } from "firebase-admin/firestore";

export const maxDuration = 300; // 5 min timeout for Pro plan

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
        }

        const db = getAdminDb();

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const roles = userData?.roles || [];
        if (!roles.includes("admin") && !roles.includes("super_admin")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        const { filters, subject, body } = await req.json();

        if (!filters || !subject || !body) {
            return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
        }

        // Collect recipients
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
                const snap = await db.collection(COLLECTIONS.USERS).get();
                snap.forEach((d: FirebaseFirestore.QueryDocumentSnapshot) => {
                    const u = d.data();
                    if (filters.state && u.state !== filters.state) return;
                    add(u.email || u.emailAddress, u.fullName || u.name || u.displayName || "User");
                });
                break;
            }
            case "buyers": {
                const snap = await db.collection(COLLECTIONS.USERS)
                    .where("marketplaceAccountType", "in", ["buyer", "both"]).get();
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
                let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                    .where("status", "==", filters.sellerStatus || "approved");
                if (filters.audience === "wholesale_sellers") q = q.where("sellerCategory", "==", "wholesale");
                if (filters.audience === "retail_sellers") q = q.where("sellerCategory", "==", "retail");
                const snap = await q.get();
                for (const d of snap.docs) {
                    const v = d.data();
                    if (filters.state && v.address?.state !== filters.state) continue;
                    const userSnap = await db.collection(COLLECTIONS.USERS).doc(v.userId).get();
                    const u = userSnap.data();
                    if (u) add(u.email || u.emailAddress, u.name || u.displayName || "Seller");
                }
                break;
            }
            case "marketplace_onboarded": {
                const snap = await db.collection(COLLECTIONS.USERS)
                    .where("marketplaceAccountType", "in", ["buyer", "seller", "both"]).get();
                snap.forEach((d: FirebaseFirestore.QueryDocumentSnapshot) => {
                    const u = d.data();
                    if (filters.state && u.state !== filters.state) return;
                    add(u.email || u.emailAddress, u.name || u.displayName || "User");
                });
                break;
            }
            case "cooperative_members": {
                const snap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("status", "==", "active").get();
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
                const snap = await db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                    .where("status", "==", "registered").get();
                for (const d of snap.docs) {
                    const r = d.data();
                    const regEmail = r.email || r.userEmail;
                    if (regEmail) add(regEmail, r.name || r.fullName || `${r.firstName || ''} ${r.surname || ''}`.trim() || "Registrant");
                }
                break;
            }
        }

        const allRecipients = Array.from(recipients.values());
        if (allRecipients.length === 0) {
            return NextResponse.json({ success: false, sent: 0, failed: 0, error: "No recipients matched the selected filters." });
        }

        // Filter bounced emails
        const bouncedSnap = await db.collection(COLLECTIONS.BOUNCED_EMAILS).get();
        const bouncedSet = new Set(bouncedSnap.docs.map(doc => doc.id.toLowerCase()));
        const validRecipients = allRecipients.filter(r => {
            const norm = r.email.toLowerCase().replace(/\//g, "_");
            return !bouncedSet.has(norm) && !bouncedSet.has(r.email.toLowerCase());
        });

        if (validRecipients.length === 0) {
            return NextResponse.json({ success: false, sent: 0, failed: 0, error: "All matched recipients have previously bounced." });
        }

        let successCount = 0;
        let failCount = 0;
        const BATCH = 100;

        for (let i = 0; i < validRecipients.length; i += BATCH) {
            const chunk = validRecipients.slice(i, i + BATCH);
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

            const res = await sendBatchEmailNotifications(payload);
            if (res.success) {
                successCount += chunk.length;
            } else {
                failCount += chunk.length;
                console.error("[Broadcast API] Batch failure:", res.error);
            }

            if (i + BATCH < validRecipients.length) await sleep(500);
        }

        // Omit csvEmails to avoid huge Firestore documents
        const logFilters = { ...filters };
        if (logFilters.csvEmails) {
            delete logFilters.csvEmails;
        }

        // Log to Firestore
        const logRef = await db.collection(COLLECTIONS.BROADCAST_LOGS).add({
            subject,
            body,
            audience: filters.audience,
            filters: logFilters,
            sentBy: session.user.id,
            sentByName: userData?.fullName || userData?.name || "Admin",
            sentAt: FieldValue.serverTimestamp(),
            totalRecipients: allRecipients.length,
            excludedBounced: allRecipients.length - validRecipients.length,
            successCount,
            failCount,
            status: failCount === 0 ? "done" : successCount === 0 ? "partial" : "partial",
        });

        return NextResponse.json({
            success: true,
            sent: successCount,
            failed: failCount,
            total: validRecipients.length,
            logId: logRef.id,
        });
    } catch (error: any) {
        console.error("[Broadcast API] Fatal error:", error);
        return NextResponse.json({ success: false, sent: 0, failed: 0, error: error.message }, { status: 500 });
    }
}
