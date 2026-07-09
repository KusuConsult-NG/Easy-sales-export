import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { isAdmin } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";

export const dynamic = "force-dynamic";

// Lazy factory — RESEND_API_KEY is a runtime secret, not available during Docker build
const getResend = () => new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>";
const MAX_BATCH = 200;

// ─── Payment type → readable name + recovery URL ────────────────────────────
function paymentTypeInfo(type: string): { label: string; url: string; description: string } {
    const map: Record<string, { label: string; url: string; description: string }> = {
        cooperative_membership_registration: {
            label: "Cooperative Membership",
            url: "https://www.easysalesexport.com/cooperatives",
            description: "Join our cooperative and access group buying, savings, and financial services.",
        },
        academy_registration: {
            label: "Academy Registration",
            url: "https://www.easysalesexport.com/academy",
            description: "Complete your Academy enrollment and start your learning journey.",
        },
        wave_registration: {
            label: "WAVE Registration",
            url: "https://www.easysalesexport.com/wave",
            description: "Complete your WAVE WASH Business training registration.",
        },
        wave_application: {
            label: "WAVE Application",
            url: "https://www.easysalesexport.com/wave",
            description: "Finish your WAVE programme application.",
        },
        marketplace_order: {
            label: "Marketplace Order",
            url: "https://www.easysalesexport.com/marketplace",
            description: "Complete your marketplace order payment.",
        },
        export_investment: {
            label: "Export Investment",
            url: "https://www.easysalesexport.com/export",
            description: "Finalize your export investment to get started.",
        },
        farm_nation_registration: {
            label: "Farm Nation Registration",
            url: "https://www.easysalesexport.com/farm-nation",
            description: "Complete your Farm Nation membership registration.",
        },
    };
    return map[type] ?? {
        label: "Payment",
        url: "https://www.easysalesexport.com",
        description: "Complete your payment to continue.",
    };
}

function formatAmount(amount: number): string {
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
    }).format(amount);
}

function buildEmailHtml(name: string | null, type: string, amount: number, status: string): string {
    const { label, url, description } = paymentTypeInfo(type);
    const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
    const statusNote =
        status === "abandoned"
            ? "It looks like you started your registration but didn't complete the payment."
            : "Your payment attempt wasn't successful — this can happen due to network issues or card limits.";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Complete your payment</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:40px 48px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Complete Your Payment</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">${label}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px 48px;">
          <p style="margin:0 0 16px;color:#374151;font-size:16px;">${greeting}</p>
          <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">${statusNote}</p>

          <!-- Amount Card -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:0 0 28px;text-align:center;">
            <p style="margin:0 0 4px;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Amount Due</p>
            <p style="margin:0;color:#111827;font-size:36px;font-weight:800;">${formatAmount(amount)}</p>
            <p style="margin:8px 0 0;color:#6b7280;font-size:14px;">${label}</p>
          </div>

          <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6;">${description}</p>

          <!-- CTA -->
          <div style="text-align:center;margin:0 0 32px;">
            <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 40px;border-radius:12px;letter-spacing:0.01em;">
              Complete Payment →
            </a>
          </div>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />
          <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6;">
            If you have questions or need help, reply to this email or contact us at
            <a href="mailto:info@easysalesexport.com" style="color:#2563eb;">info@easysalesexport.com</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 48px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:13px;">© ${new Date().getFullYear()} Easy Sales Export. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
    try {
        // ── Auth guard ──
        const session = (await requireSession()).session;
        if (!isAdmin(session?.user?.roles)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await req.json();
        const { references, dryRun = false }: { references: string[]; dryRun?: boolean } = body;

        if (!Array.isArray(references) || references.length === 0) {
            return NextResponse.json({ error: "references array required" }, { status: 400 });
        }
        if (references.length > MAX_BATCH) {
            return NextResponse.json({ error: `Max ${MAX_BATCH} per batch` }, { status: 400 });
        }

        const db = getAdminDb();
        const results: { ref: string; email: string | null; status: "sent" | "skipped" | "error"; reason?: string }[] = [];

        // ── Process in batches of 10 (Resend rate limit) ─────────────────────
        for (const reference of references) {
            try {
                // 1. Fetch failedPayments doc
                const doc = await db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference).get();
                if (!doc.exists) {
                    results.push({ ref: reference, email: null, status: "skipped", reason: "doc not found" });
                    continue;
                }
                const data = doc.data()!;
                let email: string | null = data.customerEmail ?? null;
                const name: string | null = data.customerName ?? null;
                const type: string = data.type ?? "unknown";
                const amount: number = Number(data.amount) || 0;
                const status: string = data.status ?? "unknown";

                // 2. Resolve email from users collection if missing
                if (!email && data.userId) {
                    const userDoc = await db.collection(COLLECTIONS.USERS).doc(data.userId).get();
                    if (userDoc.exists) {
                        email = userDoc.data()?.email ?? null;
                    }
                }

                if (!email) {
                    results.push({ ref: reference, email: null, status: "skipped", reason: "no email found" });
                    continue;
                }

                if (dryRun) {
                    results.push({ ref: reference, email, status: "sent", reason: "dry-run (not actually sent)" });
                    continue;
                }

                // 3. Send via Resend
                const { label } = paymentTypeInfo(type);
                await getResend().emails.send({
                    from: FROM_EMAIL,
                    to: email,
                    subject: `Complete your ${label} — ${formatAmount(amount)}`,
                    html: buildEmailHtml(name, type, amount, status),
                });

                // 4. Mark recovery email sent timestamp
                await db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference).update({
                    recoveryEmailSentAt: new Date().toISOString(),
                    recoveryEmailSentBy: session?.user?.email ?? "admin",
                });

                results.push({ ref: reference, email, status: "sent" });
            } catch (err: any) {
                results.push({ ref: reference, email: null, status: "error", reason: err.message });
            }

            // Small delay to respect Resend rate limits (10 emails/sec)
            await new Promise(r => setTimeout(r, 120));
        }

        const sent = results.filter(r => r.status === "sent").length;
        const skipped = results.filter(r => r.status === "skipped").length;
        const errors = results.filter(r => r.status === "error").length;

        return NextResponse.json({ sent, skipped, errors, results, dryRun });

    } catch (err: any) {
        logger.error("[Recovery Emails] Error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
