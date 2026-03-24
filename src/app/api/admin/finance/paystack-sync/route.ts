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
 * Fetch one page of transactions from Paystack.
 * perPage capped at 100 (Paystack limit).
 */
async function fetchPaystackPage(page: number): Promise<{ data: PaystackTx[]; meta: { total: number; pages: number } }> {
    const url = `${PAYSTACK_BASE_URL}/transaction?perPage=100&page=${page}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
        },
        cache: "no-store",
    });
    if (!res.ok) {
        throw new Error(`Paystack API error: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    return {
        data: json.data ?? [],
        meta: {
            total: json.meta?.total ?? 0,
            pages: json.meta?.pageCount ?? 1,
        },
    };
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

        // ── Fetch all pages ────────────────────────────────────────────────────
        let allTxs: PaystackTx[] = [];
        const firstPage = await fetchPaystackPage(1);
        allTxs = firstPage.data;
        const totalPages = firstPage.meta.pages;

        logger.info(`[PaystackSync] Total pages: ${totalPages}, Total transactions: ${firstPage.meta.total}`);

        // Fetch remaining pages (start from 2)
        for (let page = 2; page <= totalPages; page++) {
            const { data } = await fetchPaystackPage(page);
            allTxs = allTxs.concat(data);
        }

        logger.info(`[PaystackSync] Fetched ${allTxs.length} total transactions from Paystack`);

        // ── Check existing Firestore docs in parallel batches ─────────────────
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
