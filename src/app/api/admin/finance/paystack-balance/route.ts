export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { logger } from "@/lib/logger";
import { paystackBaseUrl } from "@/lib/paystack-host";

/**
 * GET /api/admin/finance/paystack-balance
 *
 * Fetches the live Paystack account balance.
 * Returns the balance broken down by currency (NGN).
 * Only accessible to admins with finance:read permission.
 */
export async function GET(_req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
        if (!PAYSTACK_SECRET_KEY) {
            return NextResponse.json({ success: false, error: "PAYSTACK_SECRET_KEY not configured" }, { status: 500 });
        }

        const res = await fetch(`${paystackBaseUrl()}/balance`, {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
            },
            cache: "no-store",
        });

        if (!res.ok) {
            const text = await res.text();
            logger.warn(`[PaystackBalance] Paystack API error ${res.status}: ${text}`);
            return NextResponse.json(
                { success: false, error: `Paystack API error: ${res.status}` },
                { status: 502 }
            );
        }

        const json = await res.json();

        if (!json.status) {
            return NextResponse.json(
                { success: false, error: json.message || "Paystack balance fetch failed" },
                { status: 502 }
            );
        }

        // Paystack balance is returned in kobo — convert to NGN
        const balances: Array<{ currency: string; balance: number }> = (json.data ?? []).map(
            (item: { currency: string; balance: number }) => ({
                currency: item.currency,
                balance: item.balance / 100, // kobo → naira
            })
        );

        const ngnBalance = balances.find((b) => b.currency === "NGN")?.balance ?? 0;

        return NextResponse.json({
            success: true,
            ngnBalance,
            allBalances: balances,
        });
    } catch (error: any) {
        logger.error("[PaystackBalance] Error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Internal error" },
            { status: 500 }
        );
    }
}
