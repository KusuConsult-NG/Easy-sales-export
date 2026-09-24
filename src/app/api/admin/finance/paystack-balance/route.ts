export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
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
        /*
         *   THE GATE ASKED THE TOKEN, on the route that reads the company's
         *   live bank balance.
         *
         *   `hasAdminPermission(session.user.roles, ...)` is #356's class: a
         *   JWT role claim keeps its value for up to eight hours after the
         *   database loses it, so a finance admin whose access had been revoked
         *   could go on reading the platform's Paystack balance for the rest of
         *   their session.
         *
         *   requireAdmin re-fetches the roles from the database and fails
         *   closed if it cannot — the helper #356 built for exactly this, and
         *   the one actions/admin/_withdrawals.ts already uses with this same
         *   permission. It also applies the admin MFA verdict, which every
         *   other screen an admin reaches has already applied to them.
         */
        const gate = await requireAdmin("finance:read");
        if ("error" in gate) {
            return NextResponse.json({ success: false, error: gate.error }, { status: 403 });
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
        /*
         *   The exception's own message used to be the response body. On a
         *   route that talks to Paystack with the secret key, that is whatever
         *   the HTTP client, the JSON parser or the adapter had to say about
         *   the inside of this server, handed to the caller.
         */
        logger.error("[PaystackBalance] Error:", error);
        return NextResponse.json(
            { success: false, error: "Could not read the Paystack balance" },
            { status: 500 }
        );
    }
}
