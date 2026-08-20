/**
 * POST /api/admin/broadcast/send
 *
 * Long-running API route for sending broadcast emails.
 * Uses maxDuration = 300 (Pro plan) to avoid timeout on large audiences.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { sendBatchEmailNotifications } from "@/lib/email-notifications";
import { FieldValue } from "@/lib/firestore-compat";
import { collectRecipients } from "@/app/actions/broadcast";
import { logger } from "@/lib/logger";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { rateLimit, createRateLimitResponse } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";
import { recordAdminAction } from "@/lib/audit-log";

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

/** A broadcast is not a click — a handful an hour is generous for a person. */
const broadcastLimiter = rateLimit(rateLimitConfig.admin);

/** Subject and body are stored and sent; neither was bounded. */
const MAX_SUBJECT_CHARS = 200;
const MAX_BODY_CHARS = 100_000;

export async function POST(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
        }

        const db = getAdminDb();

        // Verify admin role
        if (!hasAdminPermission(session.user.roles, "announcements:manage")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        // Throttled, which it was not.
        //
        // This route sends mail from the business's domain to as many people as
        // the filters select, and could be called as fast as requests could be
        // issued. Keyed on the account rather than the address, per the same
        // reasoning as the other admin routes: an admin behind a shared IP
        // should not spend everyone else's allowance.
        const rateLimitResult = await broadcastLimiter.check(session.user.id);
        if (!rateLimitResult.success) {
            return createRateLimitResponse(rateLimitResult);
        }
        
        // Still need userData for logging the name later
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const { filters, subject, body } = await req.json();

        if (!filters || !subject || !body) {
            return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
        }

        // Both are stored in a BROADCAST_LOGS document and sent to every
        // recipient. Neither was bounded, and a document that exceeds the row
        // limit fails the write AFTER the caller has been told the send is
        // under way.
        if (String(subject).length > MAX_SUBJECT_CHARS) {
            return NextResponse.json(
                { success: false, error: `Subject is limited to ${MAX_SUBJECT_CHARS} characters` },
                { status: 413 }
            );
        }
        if (String(body).length > MAX_BODY_CHARS) {
            return NextResponse.json(
                { success: false, error: `Message is limited to ${MAX_BODY_CHARS.toLocaleString()} characters` },
                { status: 413 }
            );
        }

        // Collect recipients using centralized stream-safe logic directly
        const { getCleanBroadcastList } = await import("@/lib/broadcast-logic");
        const listResult = await getCleanBroadcastList(filters);
        const allRecipients = listResult.success && listResult.data?.recipients ? listResult.data.recipients : [];
        
        if (allRecipients.length === 0) {
            return NextResponse.json({ success: false, sent: 0, failed: 0, error: listResult.error || "No recipients matched the selected filters." });
        }

        // Omit csvEmails to avoid huge Firestore documents
        const logFilters = { ...filters };
        if (logFilters.csvEmails) {
            delete logFilters.csvEmails;
        }

        // Log to Firestore immediately to create the record
        const logRef = await db.collection(COLLECTIONS.BROADCAST_LOGS).add({
            subject,
            body,
            audience: filters.audience,
            filters: logFilters,
            sentBy: session.user.id,
            sentByName: userData?.fullName || userData?.name || "Admin",
            sentAt: FieldValue.serverTimestamp(),
            totalRecipients: allRecipients.length,
            excludedBounced: 0,
            successCount: 0,
            failCount: 0,
            status: "sending",
        });

        // Background Processing to avoid Railway Proxy Timeout (100s limit)
        Promise.resolve().then(async () => {
            try {
                let successCount = 0;
                let failCount = 0;
                let excludedBounced = 0;
                const BATCH = 100;

                for (let i = 0; i < allRecipients.length; i += BATCH) {
                    const chunk = allRecipients.slice(i, i + BATCH);

                    // 1. Efficient Batched Bounce Check (Prevents OOM on large BOUNCED_EMAILS collection)
                    const refs: any[] = [];
                    chunk.forEach(r => {
                        refs.push(db.collection(COLLECTIONS.BOUNCED_EMAILS).doc(r.email.toLowerCase()));
                        const norm = r.email.toLowerCase().replace(/\//g, "_");
                        if (norm !== r.email.toLowerCase()) {
                            refs.push(db.collection(COLLECTIONS.BOUNCED_EMAILS).doc(norm));
                        }
                    });

                    const bounceDocs = await db.getAll(...refs);
                    const bouncedIds = new Set(bounceDocs.filter(d => d.exists).map(d => d.id));

                    const validChunk = chunk.filter(r => {
                        const isBounced = bouncedIds.has(r.email.toLowerCase()) || bouncedIds.has(r.email.toLowerCase().replace(/\//g, "_"));
                        if (isBounced) excludedBounced++;
                        return !isBounced;
                    });

                    if (validChunk.length > 0) {
                        const payload = validChunk.map(r => ({
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
                            successCount += validChunk.length;
                        } else {
                            failCount += validChunk.length;
                            logger.error("[Broadcast API] Batch failure:", res.error);
                        }
                    }

                    // Periodically update the Firestore log to show progress
                    if (i > 0 && i % 1000 === 0) {
                        await logRef.update({ successCount, failCount, excludedBounced });
                    }

                    if (i + BATCH < allRecipients.length) await sleep(500);
                }

                // Final completion state
                await logRef.update({
                    successCount,
                    failCount,
                    excludedBounced,
                    status: failCount === 0 ? "done" : successCount === 0 ? "failed" : "partial"
                });

            } catch (err) {
                logger.error("[Broadcast API] Background send error:", err);
                await logRef.update({ status: "failed" });
            }
        });

        await recordAdminAction({
            action: 'broadcast_sent',
            userId: session.user.id,
            targetType: 'broadcast',
            metadata: { subject, filters },
        });
        return NextResponse.json({
            success: true,
            sent: allRecipients.length,
            failed: 0,
            total: allRecipients.length,
            logId: logRef.id,
        });
    } catch (error: any) {
        logger.error("[Broadcast API] Fatal error:", error);
        return NextResponse.json({ success: false, sent: 0, failed: 0, error: error.message }, { status: 500 });
    }
}
