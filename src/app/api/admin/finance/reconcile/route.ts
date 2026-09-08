export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60s max execution duration

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { financeService } from "@/services";
import { eachPaystackSuccess } from "@/lib/paystack-sweep";

interface PaystackTx {
    reference: string;
    status: string;
    amount: number; // kobo
    paid_at: string | null;
}

/**
 *   #519 THE FOURTH COPY OF THE PAGING BUG, IN THE ONE PLACE THAT DIFFS MONEY.
 *
 *   This function ended its loop on
 *
 *       const totalPages = json.meta?.pageCount ?? 1;
 *
 *   which is character for character the expression analytics.service.ts records
 *   removing from three sites, with the note: "it cannot tell 'the API sent no
 *   page count' apart from 'there is one page'. When Paystack omits the field,
 *   every one of those loops stopped after page 1 and reported the hundred most
 *   recent transactions as the platform's lifetime revenue."
 *
 *   HERE THAT IS WORSE THAN AN UNDERSTATED FIGURE. This route compares Paystack
 *   against the local ledger. Reading one page means comparing the hundred most
 *   recent transactions, finding all hundred present locally, and answering
 *
 *       status: "reconciled"
 *
 *   while thousands of payments were never looked at. A reconciliation that
 *   cannot see the data is not a reconciliation that found nothing wrong.
 *
 *   The helper it should always have used was module-private to
 *   analytics.service.ts, which is why the fix reached three sweeps and not the
 *   fourth. It is lib/paystack-sweep.ts now, and it ends on a SHORT PAGE — a
 *   fact about the response rather than about its metadata — and reports
 *   `truncated` rather than letting a floor pass as a total.
 */
async function fetchAllPaystackSuccessTransactions(
    secretKey: string,
): Promise<{ transactions: PaystackTx[]; truncated: boolean }> {
    const transactions: PaystackTx[] = [];
    const sweep = await eachPaystackSuccess(
        secretKey,
        { label: "PaystackReconciliation", timeoutMs: 10_000 },
        (tx) => { transactions.push(tx as PaystackTx); },
    );
    return { transactions, truncated: sweep.truncated };
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
        const { transactions: paystackTxs, truncated: paystackTruncated } =
            await fetchAllPaystackSuccessTransactions(PAYSTACK_SECRET_KEY);

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

        //   A PARTIAL READ CANNOT RECONCILE ANYTHING.
        //
        //   Either side being truncated makes every conclusion below provisional:
        //   a short Paystack sweep manufactures a clean bill of health, and a
        //   short local sweep manufactures discrepancies. The route already knew
        //   about the local ceiling — it logged "will over-report missing
        //   payments" — and then returned the over-reported list anyway, with
        //   nothing on the response saying so. The person reading this report is
        //   the one who chases the money.
        const incomplete = paystackTruncated || localPaymentsSnap.truncated;
        if (paystackTruncated) {
            logger.error(
                "[PaystackReconciliation] the Paystack sweep hit its page ceiling — "
                + "transactions beyond it were never compared, so a clean result here means nothing.",
            );
        }

        const isFullyReconciled = !incomplete
            && missingInLocal.length === 0
            && mismatchAmounts.length === 0
            && Math.abs(revenueDiscrepancy) < 0.01;

        return NextResponse.json({
            success: true,
            status: incomplete
                ? "incomplete"
                : (isFullyReconciled ? "reconciled" : "discrepancies_found"),
            timestamp: new Date().toISOString(),
            //   Which side could not be read in full. Named rather than logged,
            //   because the discrepancies below are only as trustworthy as the
            //   two sets they were computed from.
            incomplete,
            truncated: {
                paystack: paystackTruncated,
                local: localPaymentsSnap.truncated === true,
            },
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
