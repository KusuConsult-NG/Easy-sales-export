export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby max; upgrade to 300 on Pro if needed

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const PAYSTACK_BASE_URL = "https://api.paystack.co";

interface PaystackTx {
    reference: string;
    status: "success" | "failed" | "abandoned";
    amount: number; // kobo
    paid_at: string | null;
    created_at: string;
    metadata: Record<string, any>;
    gateway_response: string;
    channel: string | null;
    currency: string;
    customer: { email: string; first_name?: string; last_name?: string } | null;
}

/**
 * Fetch ALL pages for a given Paystack status bucket.
 * status param: 'success' | 'failed' | 'abandoned'
 * perPage is capped at 100 by Paystack.
 */
async function fetchAllPaystackByStatus(status: string): Promise<PaystackTx[]> {
    const all: PaystackTx[] = [];
    let page = 1;

    while (true) {
        const url = `${PAYSTACK_BASE_URL}/transaction?perPage=100&page=${page}&status=${status}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
            },
            cache: "no-store",
        });
        if (!res.ok) {
            throw new Error(`Paystack API error (status=${status}, page=${page}): ${res.status} ${res.statusText}`);
        }
        const json = await res.json();
        const data: PaystackTx[] = json.data ?? [];
        all.push(...data);

        const totalPages: number = json.meta?.pageCount ?? 1;
        logger.info(`[PaystackSync] ${status} page ${page}/${totalPages} — ${data.length} txs`);
        if (page >= totalPages || data.length === 0) break;
        page++;
    }

    return all;
}

/**
 * GET /api/admin/finance/paystack-sync
 *
 * Fetches ALL Paystack transactions from the Paystack API and back-fills any
 * missing records into Firestore (processedPayments / failedPayments).
 *
 * This is idempotent — existing Firestore docs are skipped, never overwritten.
 */
async function paystackSyncHandler(_req: NextRequest) {
    try {
        // ── Auth guard ────────────────────────────────────────────────────────
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        if (!PAYSTACK_SECRET_KEY) {
            return NextResponse.json({ success: false, error: "PAYSTACK_SECRET_KEY not configured" }, { status: 500 });
        }

        // ── Fetch all pages from Paystack — one pass per status bucket ──────────
        // Paystack's /transaction endpoint without a status filter does NOT reliably
        // return all abandoned transactions. We must query each status explicitly.
        logger.info("[PaystackSync] Fetching success, failed, and abandoned transactions from Paystack...");

        const [successTxs, failedTxs, abandonedTxs] = await Promise.all([
            fetchAllPaystackByStatus("success"),
            fetchAllPaystackByStatus("failed"),
            fetchAllPaystackByStatus("abandoned"),
        ]);

        // Deduplicate by reference (a tx should only appear in one bucket, but just in case)
        const seen = new Set<string>();
        const allTxs: PaystackTx[] = [];
        for (const tx of [...successTxs, ...failedTxs, ...abandonedTxs]) {
            if (!seen.has(tx.reference)) {
                seen.add(tx.reference);
                allTxs.push(tx);
            }
        }

        logger.info(`[PaystackSync] Fetched ${allTxs.length} total (success: ${successTxs.length}, failed: ${failedTxs.length}, abandoned: ${abandonedTxs.length})`);

        // ── Back-fill missing docs into Firestore ──────────────────────────────
        let synced = 0;
        let skipped = 0;
        let errors = 0;

        // Process in chunks to avoid overwhelming Firestore
        const CHUNK = 50;
        for (let i = 0; i < allTxs.length; i += CHUNK) {
            const chunk = allTxs.slice(i, i + CHUNK);

            await Promise.allSettled(
                chunk.map(async (tx) => {
                    try {
                        const reference = tx.reference;
                        const isSuccess = tx.status === "success";
                        const isFailed = tx.status === "failed";
                        const isAbandoned = tx.status === "abandoned";
                        const amountNGN = tx.amount / 100;
                        const metadata = tx.metadata || {};
                        const type = metadata.type ?? "payment";
                        const userId = metadata.userId ?? null;

                        if (isSuccess) {
                            const docRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
                            const snap = await docRef.get();
                            if (!snap.exists) {
                                await docRef.set({
                                    reference,
                                    type,
                                    userId,
                                    amount: amountNGN,
                                    status: "completed",
                                    processedAt: tx.paid_at ? new Date(tx.paid_at) : FieldValue.serverTimestamp(),
                                    source: "paystack_sync",
                                    channel: tx.channel ?? null,
                                    currency: tx.currency ?? "NGN",
                                    customerEmail: tx.customer?.email ?? null,
                                    metadata,
                                });
                                synced++;
                                logger.info(`[PaystackSync] Back-filled successful payment: ${reference}`);
                            } else {
                                skipped++;
                            }
                        } else if (isFailed || isAbandoned) {
                            const docRef = db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference);
                            const snap = await docRef.get();
                            if (!snap.exists) {
                                await docRef.set({
                                    reference,
                                    type,
                                    userId,
                                    amount: amountNGN,
                                    status: isAbandoned ? "abandoned" : "failed",
                                    gatewayResponse: tx.gateway_response ?? null,
                                    channel: tx.channel ?? null,
                                    currency: tx.currency ?? "NGN",
                                    customerEmail: tx.customer?.email ?? null,
                                    customerName: tx.customer?.first_name
                                        ? `${tx.customer.first_name} ${tx.customer.last_name ?? ""}`.trim()
                                        : null,
                                    failedAt: tx.created_at ? new Date(tx.created_at) : FieldValue.serverTimestamp(),
                                    abandonedAt: isAbandoned
                                        ? (tx.created_at ? new Date(tx.created_at) : FieldValue.serverTimestamp())
                                        : null,
                                    paystackEvent: isAbandoned ? "charge.abandoned" : "charge.failed",
                                    metadata,
                                    source: "paystack_sync",
                                });
                                synced++;
                                logger.info(`[PaystackSync] Back-filled ${tx.status} payment: ${reference}`);
                            } else {
                                skipped++;
                            }
                        } else {
                            // Pending / initialised — ignore
                            skipped++;
                        }
                    } catch (err: any) {
                        errors++;
                        logger.error(`[PaystackSync] Error processing ${tx.reference}:`, err);
                    }
                })
            );
        }

        logger.info(`[PaystackSync] Done. synced=${synced} skipped=${skipped} errors=${errors}`);

        return NextResponse.json({
            success: true,
            total: allTxs.length,
            breakdown: {
                success: successTxs.length,
                failed: failedTxs.length,
                abandoned: abandonedTxs.length,
            },
            synced,
            skipped,
            errors,
        });
    } catch (error: any) {
        logger.error("[PaystackSync] Fatal error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Internal error" },
            { status: 500 }
        );
    }
}

export const GET = paystackSyncHandler;
