export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60s max execution duration

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { financeService } from "@/services";
import { paystackBaseUrl } from "@/lib/paystack-host";

const PAYSTACK_BASE_URL = paystackBaseUrl();

interface PaystackTx {
    reference: string;
    status: string;
    amount: number; // kobo
    paid_at: string | null;
}

/**
 * Helper to fetch all successful transactions from Paystack API.
 */
async function fetchAllPaystackSuccessTransactions(secretKey: string): Promise<PaystackTx[]> {
    const all: PaystackTx[] = [];
    let page = 1;

    while (true) {
        const url = `${PAYSTACK_BASE_URL}/transaction?perPage=100&page=${page}&status=success`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${secretKey}`,
                "Content-Type": "application/json",
            },
            cache: "no-store",
        });

        if (!res.ok) {
            throw new Error(`Paystack API returned ${res.status}: ${res.statusText}`);
        }

        const json = await res.json();
        const data: PaystackTx[] = json.data ?? [];
        all.push(...data);

        const totalPages = json.meta?.pageCount ?? 1;
        if (page >= totalPages || data.length === 0) break;
        page++;
    }

    return all;
}

export async function GET(req: NextRequest) {
    try {
        // 1. Session and Permission Guards
        const session = (await requireSession()).session;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
        if (!PAYSTACK_SECRET_KEY) {
            return NextResponse.json({ success: false, error: "PAYSTACK_SECRET_KEY not configured" }, { status: 500 });
        }

        // 2. Fetch local metrics using FinanceService
        const localMetrics = await financeService.getVerifiedRevenueMetrics();

        // 3. Retrieve all processed payments references from Firestore to identify missing ones
        //
        // .all(), because this is the set the whole report is diffed against.
        // A bare .get() stops at DEFAULT_QUERY_LIMIT (5,000) and hands back a
        // snapshot indistinguishable from a complete one — so every Paystack
        // transaction whose local record sat past row 5,000 was reported as
        // "missing in local": money Paystack took that the platform appears
        // never to have recorded. A reconciliation that manufactures its own
        // discrepancies is worse than one that does not run.
        const localPaymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).all().get();
        if (localPaymentsSnap.truncated) {
            logger.error(
                "[PaystackReconciliation] processed_payments hit the unbounded ceiling — "
                + "the report below understates local records and will over-report missing payments.",
            );
        }
        const localReferences = new Set<string>();
        const localDetails: Record<string, number> = {};

        localPaymentsSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.reference) {
                localReferences.add(data.reference);
                localDetails[data.reference] = data.amount || 0;
            }
        });

        // 4. Fetch authoritative success transactions from Paystack API
        logger.info("[PaystackReconciliation] Fetching successful transactions from Paystack API...");
        const paystackTxs = await fetchAllPaystackSuccessTransactions(PAYSTACK_SECRET_KEY);

        // 5. Audit & Aggregate Paystack totals
        let paystackRevenue = 0;
        const missingInLocal: Array<{ reference: string; amount: number; paidAt: string | null }> = [];
        const mismatchAmounts: Array<{ reference: string; localAmount: number; paystackAmount: number }> = [];

        paystackTxs.forEach(tx => {
            const paystackAmountNGN = tx.amount / 100;
            paystackRevenue += paystackAmountNGN;

            if (!localReferences.has(tx.reference)) {
                missingInLocal.push({
                    reference: tx.reference,
                    amount: paystackAmountNGN,
                    paidAt: tx.paid_at,
                });
            } else {
                const localAmount = localDetails[tx.reference];
                if (Math.abs(localAmount - paystackAmountNGN) > 0.01) {
                    mismatchAmounts.push({
                        reference: tx.reference,
                        localAmount,
                        paystackAmount: paystackAmountNGN,
                    });
                }
            }
        });

        const revenueDiscrepancy = localMetrics.verifiedRevenue - paystackRevenue;
        const countDiscrepancy = localMetrics.transactionCount - paystackTxs.length;

        const isFullyReconciled = missingInLocal.length === 0 && mismatchAmounts.length === 0 && Math.abs(revenueDiscrepancy) < 0.01;

        return NextResponse.json({
            success: true,
            status: isFullyReconciled ? "reconciled" : "discrepancies_found",
            timestamp: new Date().toISOString(),
            summary: {
                local: {
                    totalRevenue: localMetrics.verifiedRevenue,
                    transactionCount: localMetrics.transactionCount,
                },
                paystack: {
                    totalRevenue: paystackRevenue,
                    transactionCount: paystackTxs.length,
                },
                discrepancies: {
                    revenueDifference: revenueDiscrepancy,
                    countDifference: countDiscrepancy,
                    missingInLocalCount: missingInLocal.length,
                    mismatchAmountCount: mismatchAmounts.length,
                }
            },
            auditDetails: {
                missingInLocal,
                mismatchAmounts,
            }
        });

    } catch (err: any) {
        logger.error("[PaystackReconciliation] Fatal error during audit:", err);
        return NextResponse.json(
            { success: false, error: err.message || "Internal server error during reconciliation" },
            { status: 500 }
        );
    }
}
