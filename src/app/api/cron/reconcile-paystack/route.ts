export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { Timestamp } from "@/lib/firestore-compat";

/**
 * Automated Paystack ↔ Firebase Reconciliation
 *
 * Cron job endpoint — triggered daily by Railway Cron at 06:00 WAT.
 * Also callable manually from the admin dashboard.
 *
 * What it checks:
 *   1. Fetches all successful Paystack transactions (last 30 days)
 *   2. Compares against processedPayments collection in Firestore
 *   3. Identifies transactions missing from Firebase (payment collected, record absent)
 *   4. Writes results to system_health/paystack_reconciliation in Firestore
 *   5. Returns summary JSON for Railway cron logs
 *
 * Authorization: Bearer CRON_SECRET header required in production.
 */
export async function GET(request: NextRequest) {
    // ── Auth gate ────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get("Authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
        return NextResponse.json(
            { error: "CRON_SECRET not configured" },
            { status: 500 }
        );
    }

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
            { error: "Unauthorized. Provide Authorization: Bearer <CRON_SECRET>" },
            { status: 401 }
        );
    }

    const startedAt = new Date();
    const results: {
        status: "ok" | "warning" | "critical";
        paystackTotal: number;
        firebaseTotal: number;
        missingInFirebase: Array<{
            reference: string;
            amount: number;
            email: string | undefined;
            date: string;
            channel: string;
        }>;
        discrepancies: number;
        runAt: string;
        durationMs: number;
        error?: string;
    } = {
        status: "ok",
        paystackTotal: 0,
        firebaseTotal: 0,
        missingInFirebase: [],
        discrepancies: 0,
        runAt: startedAt.toISOString(),
        durationMs: 0,
    };

    try {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!secretKey) {
            throw new Error("PAYSTACK_SECRET_KEY is not set in environment");
        }

        // ── 1. Fetch Paystack successful transactions (last 30 days) ────────────
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const fromDate = thirtyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

        let allPaystackTransactions: Array<{
            reference: string;
            amount: number;
            paid_at: string;
            channel: string;
            customer?: { email?: string };
        }> = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const response = await fetch(
                `https://api.paystack.co/transaction?perPage=100&page=${page}&status=success&from=${fromDate}`,
                {
                    headers: { Authorization: `Bearer ${secretKey}` },
                    // 15s timeout per page fetch
                    signal: AbortSignal.timeout(15000),
                }
            );

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Paystack API error (${response.status}): ${errText.slice(0, 200)}`);
            }

            const data = await response.json();
            allPaystackTransactions = allPaystackTransactions.concat(data.data || []);

            if (page < (data.meta?.pageCount || 1)) {
                page++;
            } else {
                hasMore = false;
            }
        }

        results.paystackTotal = allPaystackTransactions.length;

        // ── 2. Fetch Firebase processedPayments references ───────────────────────
        const paymentsSnapshot = await db
            .collection("processedPayments")
            .where("status", "==", "completed")
            .get();

        const firebaseRefs = new Set<string>();
        paymentsSnapshot.docs.forEach(doc => {
            const ref = doc.data().reference || doc.data().paystackReference || doc.data().ref;
            if (ref) firebaseRefs.add(ref);
        });

        results.firebaseTotal = firebaseRefs.size;

        // ── 3. Find and Auto-Heal transactions in Paystack but not in Firebase ──────────────────
        const { 
            processMarketplaceOrder, 
            processExportInvestment, 
            processCooperativeRegistration, 
            processAcademyRegistration, 
            processCooperativeContribution 
        } = await import("@/infrastructure/payments/service");

        for (const tx of allPaystackTransactions) {
            if (!firebaseRefs.has(tx.reference)) {
                // Fetch complete metadata from Paystack API to correctly route payment
                try {
                    const txDetailRes = await fetch(
                        `https://api.paystack.co/transaction/verify/${tx.reference}`,
                        {
                            headers: { Authorization: `Bearer ${secretKey}` },
                            signal: AbortSignal.timeout(10000),
                        }
                    );
                    if (txDetailRes.ok) {
                        const detail = await txDetailRes.json();
                        if (detail.status && detail.data?.status === "success") {
                            const data = detail.data;
                            const amountPaidv = data.amount / 100;
                            const metadata = data.metadata || {};
                            const rawUserId = metadata.userId;
                            let userId = rawUserId;

                            // Resolve legacy Firebase UID to active Supabase ID if migrated
                            if (rawUserId) {
                                const userDoc = await db.collection("users").doc(rawUserId).get();
                                if (userDoc.exists) {
                                    const userData = userDoc.data();
                                    if (userData?._migratedTo) {
                                        userId = userData._migratedTo;
                                    } else if (userData?.supabaseAuthId) {
                                        userId = userData.supabaseAuthId;
                                    }
                                }
                            }

                            const type = metadata.type || metadata.purpose || null;
                            const paidAtDate = data.paid_at ? new Date(data.paid_at) : undefined;

                            console.log(`[Reconciliation Cron] Auto-healing missing payment ${tx.reference} of type "${type}" for user: ${userId}`);

                            if (type === "marketplace_order") {
                                await processMarketplaceOrder(tx.reference, amountPaidv, userId, paidAtDate);
                            } else if (type === "export_investment") {
                                const exportId = metadata.exportId;
                                await processExportInvestment(tx.reference, amountPaidv, userId, exportId, paidAtDate);
                            } else if (type === "cooperative_membership_registration") {
                                const tier = metadata.membershipTier || metadata.plan || "Member";
                                const membershipId = metadata.membershipId || userId;
                                await processCooperativeRegistration(tx.reference, amountPaidv, userId, tier, membershipId, paidAtDate);
                            } else if (type === "academy_registration") {
                                const plan = metadata.plan;
                                await processAcademyRegistration(tx.reference, amountPaidv, userId, plan, paidAtDate);
                            } else if (type === "contribution") {
                                await processCooperativeContribution(tx.reference, amountPaidv, userId, paidAtDate);
                            } else if (type === "wallet_funding") {
                                const { confirmWalletFundingAction } = await import("@/app/actions/wallet");
                                await confirmWalletFundingAction(tx.reference, paidAtDate);
                            }

                            // Successfully processed — increment local counter and add to set to bypass discrepancy marking
                            results.firebaseTotal++;
                            firebaseRefs.add(tx.reference);
                            continue;
                        }
                    }
                } catch (healErr) {
                    console.error(`[Reconciliation Cron] Failed to auto-heal transaction ${tx.reference}:`, healErr);
                }

                // If verification/processing fails, log as discrepancy in system health dashboard
                results.missingInFirebase.push({
                    reference: tx.reference,
                    amount: tx.amount / 100,
                    email: tx.customer?.email,
                    date: tx.paid_at,
                    channel: tx.channel,
                });
            }
        }

        results.discrepancies = results.missingInFirebase.length;
        results.status =
            results.discrepancies === 0 ? "ok" :
            results.discrepancies <= 3  ? "warning" : "critical";

    } catch (err: unknown) {
        results.status = "critical";
        results.error = err instanceof Error ? err.message : String(err);
    }

    // ── 4. Write results to Firestore system_health collection ──────────────────
    results.durationMs = Date.now() - startedAt.getTime();

    try {
        await db
            .collection("system_health")
            .doc("paystack_reconciliation")
            .collection("runs")
            .add({
                ...results,
                // Store only the first 20 discrepancies to avoid huge docs
                missingInFirebase: results.missingInFirebase.slice(0, 20),
                runAt: Timestamp.fromDate(startedAt),
            });

        // Update the "latest" snapshot for quick dashboard reads
        await db
            .collection("system_health")
            .doc("paystack_reconciliation")
            .set({
                status:        results.status,
                discrepancies: results.discrepancies,
                paystackTotal: results.paystackTotal,
                firebaseTotal: results.firebaseTotal,
                lastRunAt:     Timestamp.fromDate(startedAt),
                durationMs:    results.durationMs,
                ...(results.error ? { lastError: results.error } : {}),
            }, { merge: true });

    } catch (writeErr) {
        // Non-fatal — the reconciliation result is still returned in the response
        console.error("Failed to write reconciliation results to Firestore:", writeErr);
    }

    // Invalidate Redis caches to ensure Total Revenue and other dashboard stats update immediately if we healed any records
    if (results.firebaseTotal > 0) {
        try {
            const { deleteCache, deleteCachePattern } = await import("@/lib/redis");
            await deleteCache("admin:finance-overview:global");
            await deleteCache("admin:dashboard-stats:global");
            await deleteCachePattern("admin:dashboard-stats:*");
            await deleteCache("admin:coop-reports:global");
            await deleteCachePattern("admin:coop-reports:*");
            console.log("[Reconciliation Cron] Invalidated finance, dashboard, and coop report Redis caches.");
        } catch (cacheErr: any) {
            console.error("[Reconciliation Cron] Cache invalidation error:", cacheErr);
        }
    }

    // ── 5. Return summary ────────────────────────────────────────────────────────
    const httpStatus =
        results.status === "ok"       ? 200 :
        results.status === "warning"  ? 200 :
        results.error                 ? 500 : 200;

    return NextResponse.json(results, { status: httpStatus });
}
