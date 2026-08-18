"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { claimPaymentOnce, incrementWithinCeiling } from "@/lib/wallet-ledger";
import { checkOrderPaymentAmount } from "@/lib/order-payment-amount";
import { revalidatePath } from "next/cache";
import { toMillis } from "@/lib/firestore-serialize";
import { getBaseUrl } from "@/lib/server-utils";

// ============================================
// Get User Export Investments Action
// ============================================

export async function getUserExportInvestmentsAction(
    limit: number = 10,
    lastId?: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user?.id) { return { error: "Authentication required", success: false as const, data: null };
        }

        const userId = session.user.id;

        // Fetch user's active Paystack-verified EXPORT_INVESTMENTS
        const query = db.collection(COLLECTIONS.EXPORT_INVESTMENTS)
            .where("investorId", "==", userId)

        const snapshotRaw = await query.get();
        // Robust Sort: Handle both Timestamps and String dates gracefully
        const allDocs = snapshotRaw.docs.sort((a, b) => { const dataA = a.data();
             const dataB = b.data();
             // A local getMillis lived here and was CORRECT — it handled all four
             // shapes. It was a fourth copy of lib/firestore-serialize's toMillis,
             // which is why the sort 340 lines below, written without it, was the
             // one that threw. One implementation.
             const tA = toMillis(dataA.createdAt) || toMillis(dataA.bookedAt);
             const tB = toMillis(dataB.createdAt) || toMillis(dataB.bookedAt);
             return tB - tA;
        });

        // Manual Pagination
        let startIndex = 0;
        if (lastId) { const idx = allDocs.findIndex(d => d.id === lastId);
             if (idx !== -1) startIndex = idx + 1;
        }
        const paginatedDocs = allDocs.slice(startIndex, startIndex + limit);

        const investments = await Promise.all(paginatedDocs.map(async doc => { const data = doc.data();
            // Soft-join to get the actual Export Window details dynamically
            let commodity = data.commodity || "Export Opportunity";
            let status = data.status || "pending";
            let startDate = new Date().toISOString();
            let endDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
            let daysRemaining = 0;

            if (data.windowId) {
                 const windowId = data.windowId;
                 const windowDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(windowId).get();
                 if (windowDoc.exists) {
                     const wData = windowDoc.data()!;
                     commodity = wData.title || wData.commodity || commodity;
                     status = wData.status || status; // Reflect parent window status
                     startDate = wData.startDate?.toDate()?.toISOString() || startDate;
                     endDate = wData.endDate?.toDate()?.toISOString() || endDate;
                     if (wData.endDate) {
                         const delivery = wData.endDate.toDate();
                         const diffTime = delivery.getTime() - new Date().getTime();
                         daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
                     }
                 }
            }

            // Real investment logic calculations
            const amount = data.amount || data.totalCost || 0;
            const expectedReturn = data.expectedReturn || (amount * 0.20);

            const formatDate = (val: any) => { if (!val) return new Date().toISOString();
                if (typeof val.toDate === 'function') return val.toDate().toISOString();
                if (val instanceof Date) return val.toISOString();
                if (typeof val === 'string') return new Date(val).toISOString();
                if (val.seconds) return new Date(val.seconds * 1000).toISOString();
                return new Date().toISOString();
            };

            return { id: doc.id,
                commodity,
                amount,
                expectedReturn,
                status,
                daysRemaining,
                startDate,
                endDate,
                createdAt: formatDate(data.createdAt) };
        }));

        const lastDocId = paginatedDocs.length === limit ? paginatedDocs[paginatedDocs.length - 1].id : null;

        return { error: null, success: true as const, data: investments, meta: { cursor: lastDocId, hasMore: !!lastDocId }
        };
    } catch (error: any) { logger.error("Get user export investments error:", error);
        return { error: "Failed to fetch investments", success: false as const, meta: null };
    }
}


// ============================================
// Get User Export Stats Action
// ============================================

export async function getUserExportStatsAction() { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user?.id) { return { error: "Authentication required", success: false as const, data: null };
        }

        const userId = session.user.id;

        // Fetch O(1) Compiled Stats from Active Paystack Integration
        const portfolioDoc = await db.collection(COLLECTIONS.INVESTOR_PORTFOLIOS).doc(userId).get();

        if (portfolioDoc.exists) { const data = portfolioDoc.data()!;
             return { error: null, success: true as const,
                 meta: null
             , data: {
                 totalInvested: data.totalInvested || 0,
                 activeInvestments: data.activeInvestments || 0,
                 totalReturns: data.totalReturns || 0,
                 pendingReturns: data.pendingReturns || 0
             } };
        }

        // Fallback if no portfolio exists yet
        return { 
            error: null, success: true as const, 
            data: { totalInvested: 0, activeInvestments: 0, totalReturns: 0, pendingReturns: 0 } 
        };
    } catch (error: any) { logger.error("Get user export stats error:", error);
        return { error: "Failed to fetch stats", success: false as const, meta: null, data: null };
    }
}


// ============================================
// Invest in Export Window
// ============================================

export async function investInExportAction(
    exportId: string,
    amount: number
): Promise<{ success: true; error: null; data: { authorizationUrl: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Authentication required"};
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) { return { success: false as const, error: "Export window not found"};
        }

        const exportData = exportDoc.data();
        if (exportData?.status !== "open" && exportData?.status !== "active") { return { success: false as const, error: "This export window is not open for investment"};
        }

        // Validate Minimum Investment (assuming 'amount' in window is unit price or min investment)
        const minInvestment = exportData?.amount || 50000; // Default fallback
        if (amount < minInvestment) { return { success: false as const, error: `Minimum investment is ₦${minInvestment.toLocaleString()}` };
        }

        // Check Funding Limit (Optional - if totalSpots defined)
        if (exportData?.totalSpots && exportData?.spotsFilled >= exportData?.totalSpots) { return { success: false as const, error: "Investment slots are full"};
        }

        // A callback that is a page, on the base URL everything else uses.
        //
        // This was `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/export/verify`.
        // There is no /dashboard/export route segment at all — the export
        // dashboard is /export/(app)/dashboard — so an investor who paid through
        // this action was charged and landed on a 404, and the verification that
        // would have created their slot never ran.
        //
        // NEXT_PUBLIC_APP_URL was also read bare: unset, the callback becomes
        // the literal string "undefined/dashboard/export/verify". getBaseUrl()
        // is what the other export payment initiator uses.
        //
        // `flow=window` selects this pair's verifier on the callback page. That
        // page calls verifyInvestmentPaymentAction by default, which looks for
        // an EXPORT_INVESTMENTS record created at initiation — a record this
        // action does not create — so without it the investor would have been
        // told "Investment record not found" instead of hitting a 404.
        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/export/payment/callback?flow=window`;

        // Initialize Paystack
        const { initializePaystackPayment } = await import("@/lib/paystack-server");
        const initResult = await initializePaystackPayment(
            session.user.email || "",
            Math.round(amount * 100), // Kobo
            { type: "export_investment",
                exportId,
                userId: session.user.id,
                amount,
                email: session.user.email,
                callback_url: callbackUrl
            },
            callbackUrl
        );

        return { error: null, success: true as const, data: initResult };

    } catch (error: any) { logger.error("Invest in export error:", error);
        return { success: false as const, error: error.message || "Investment initialization failed"};
    }
}


// ============================================
// Verify Export Investment
// ============================================

export async function verifyExportInvestmentAction(reference: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized"};

        const { verifyPaystackPayment } = await import("@/lib/paystack-server");
        const verify = await verifyPaystackPayment(reference);

        if (!verify.status || verify.data.status !== "success") { return { success: false as const, error: "Payment verification failed"};
        }

        const metadata = verify.data.metadata;
        if (metadata.type !== "export_investment") { return { success: false as const, error: "Invalid payment type"};
        }

        const userId = metadata.userId;
        const exportId = metadata.exportId;

        if (userId !== session.user.id) return { success: false as const, error: "User mismatch"};

        // The amount PAID, not the amount requested.
        //
        // This read `const amount = metadata.amount` — the figure the investor
        // asked to invest when the payment was initialised — and then used it as
        // the slot's amount, as the window's funding increment, as the basis for
        // expectedReturn and as the ledger row's amount. What Paystack actually
        // collected was never looked at, and the two were never compared.
        //
        // Both other paths that fulfil this same payment do use the paid figure:
        // the webhook is handed `data.amount / 100`, and
        // verifyInvestmentPaymentAction reads `paymentData.data.amount / 100`
        // and refuses a mismatch against the metadata in either direction. This
        // was the third path and the only permissive one — the same shape as the
        // marketplace order and academy registration defects, with the loose
        // side here.
        const paidAmount = verify.data.amount / 100;
        const requestedAmount = Number(metadata.amount);

        const amountVerdict = checkOrderPaymentAmount(paidAmount, requestedAmount);
        if (!amountVerdict.ok) {
            logger.error("[verifyExportInvestmentAction] investment payment refused on amount", {
                reference, exportId, paidAmount, requestedAmount, reason: amountVerdict.reason,
            });
            return { success: false as const, error: "Payment amount does not match the investment that was initiated." };
        }

        // Everything below settles on what was collected.
        const amount = paidAmount;

        // WHAT WAS WRONG HERE
        // -------------------
        // This is the client-side half of the same payment the Paystack webhook
        // fulfils in infrastructure/payments/service.ts. Both wrote
        // processed_payments.doc(reference), and both decided whether to run by
        // reading it first — so a webhook arriving while the buyer sat on this
        // callback page had both paths pass the check and both fulfil: two
        // EXPORT_SLOTS rows and the window funded twice for one payment.
        //
        // Worse, `set()` on that document is an upsert. The webhook writes
        // `status: "completed"`, which platform_revenue_totals() sums as
        // revenue; this path wrote no status at all and OVERWROTE the webhook's
        // row, silently removing that payment from the revenue figure.
        //
        // Claiming the reference fixes all three: exactly one path fulfils, the
        // row is written once, and the status survives.
        //
        // The overfunding check is copied from the webhook path so that
        // whichever side wins, an investment beyond the funding goal is routed
        // to review rather than counted. It is an advisory read — two
        // investments that each fit but together exceed the goal can still both
        // pass, exactly as on the webhook side. That race is recorded in
        // docs/audit/atomic-money-migration.md and wants a decision, not a
        // patch smuggled in here.
        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportSnap = await exportRef.get();
        const exportWindow = exportSnap.data();

        if (!exportSnap.exists || !exportWindow) {
            return { success: false as const, error: "Export window not found" };
        }

        const fundingGoal = exportWindow.fundingGoal ?? exportWindow.goal ?? 0;
        const currentFunded = exportWindow.fundedAmount ?? exportWindow.currentFunding ?? 0;
        const overfunded = fundingGoal > 0 && currentFunded + amount > fundingGoal;

        const claim = await claimPaymentOnce({
            reference,
            userId,
            amount,
            type: "export_investment",
            source: "client_verify",
            // Not "completed" when overfunded: global-aggregation must not count
            // a payment that is being held for review as revenue.
            status: overfunded ? "overfunded_review" : "completed",
            metadata: { exportId },
        });

        if (!claim.claimed) {
            return { success: false as const, error: "Payment already processed" };
        }

        if (overfunded) {
            await db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference).set({
                reference,
                type: "export_investment",
                userId,
                exportId,
                amount,
                status: "overfunded_review",
                gatewayResponse: "Investment exceeds export window funding goal",
                failedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            logger.warn("[verifyExportInvestmentAction] investment exceeds funding goal — routed to review", {
                reference, exportId, amount, fundingGoal, currentFunded,
            });

            return {
                success: false as const,
                error: "This investment exceeds the window's remaining funding goal and has been sent for review. You have been charged and will be contacted.",
            };
        }

        {
            // 1. Create Investment Record (Slot)
            const slotRef = db.collection(COLLECTIONS.EXPORT_SLOTS).doc();
            await slotRef.set({
                userId,
                exportId,
                amount,
                status: "active",
                paymentReference: reference,
                purchaseDate: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                roi: exportWindow.roiPercentage || exportWindow.roi || "15-20%",
                expectedReturn: amount * (exportWindow.returnMultiplier ?? exportWindow.expectedReturnMultiplier ?? 1.20),
                source: "client_verify",
            });

            // 2. Update Export Window Stats
            //
            // TWO PROBLEMS, BOTH VISIBLE BY COMPARISON WITH THE OTHER TWO PATHS.
            //
            // The increment carried no ceiling. The overfunding check above is
            // an advisory READ — its own comment says two investments that each
            // fit but together exceed the goal can both pass — and a plain
            // increment then pushes fundedAmount past the goal regardless. The
            // webhook and verifyInvestmentPaymentAction both use
            // incrementWithinCeiling, which locks the row and checks the ceiling
            // held on that same record, so the check is the write.
            //
            // And `currentFunding` was never touched. Both other paths keep it
            // in step with fundedAmount, and it is the counter
            // initializeInvestmentPaymentAction reads to decide whether a window
            // still has room. So money taken through this path was invisible to
            // that gate: the window kept accepting new investors after its goal
            // was met, and each of them then hit the ceiling on fundedAmount and
            // was refused after being charged.
            const ceilingField = exportWindow?.fundingGoal !== undefined ? "fundingGoal" : "goal";
            const raised = await incrementWithinCeiling({
                collection: COLLECTIONS.EXPORT_WINDOWS,
                id: exportId,
                field: "fundedAmount",
                amount,
                ceilingField,
            });

            if (!raised.ok) {
                // Charged, and the window filled in between. Recorded for review
                // rather than silently dropped — the same treatment the
                // overfunded branch above gives.
                await db.collection(COLLECTIONS.FAILED_PAYMENTS).doc(reference).set({
                    reference,
                    type: "export_investment",
                    userId,
                    exportId,
                    amount,
                    status: "overfunded_review",
                    gatewayResponse: "Funding goal reached before this investment was applied",
                    failedAt: FieldValue.serverTimestamp(),
                }, { merge: true });

                logger.warn("[verifyExportInvestmentAction] funding ceiling reached — routed to review", {
                    reference, exportId, amount, fundingGoal,
                });

                return {
                    success: false as const,
                    error: "This window reached its funding goal before your investment was applied. You have been charged and will be contacted.",
                };
            }

            // The remaining counters carry no ceiling. currentFunding duplicates
            // fundedAmount and is kept in step deliberately — both names are read
            // elsewhere.
            await exportRef.update({
                spotsFilled: FieldValue.increment(1),
                currentFunding: FieldValue.increment(amount),
                updatedAt: FieldValue.serverTimestamp()
            });

            // (The processed_payments row is written by claimPaymentOnce above.)
        }

        await createAdminAuditLog({ action: "export_investment",
            userId,
            targetId: exportId,
            targetType: "export_window",
            metadata: { amount, reference }
        });

        // /dashboard/export is not a route — the export dashboard is at
        // /export/dashboard (the (app) segment is a route group and does not
        // appear in the URL). revalidatePath on a path with no route behind it
        // is a silent no-op, so this invalidated nothing.
        revalidatePath("/export/dashboard");
        revalidatePath(`/export/windows/${exportId}`);

        return { error: null, success: true as const , data: { message: "Investment verified" } };

    } catch (error: any) { logger.error("Verify export investment error:", error);
        return { success: false as const, error: "Failed to verify investment"};
    }
}


// ============================================
// Get My Investments (Revised for Investors)
// ============================================

export async function getMyExportInvestmentsAction() { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized"};

        const snapshot = await db.collection(COLLECTIONS.EXPORT_INVESTMENTS)
            .where("investorId", "==", session.user.id)
            .get();
        // Use in-memory sort to avoid index compilation errors
        // toMillis, not `x?.toMillis()`.
        //
        // `createdAt?.toMillis()` guards against createdAt being null — and NOT
        // against it being a string, which is what the JSONB writer stores for a
        // `new Date()`. `"2026-08-01..."?.toMillis` is undefined, and calling it
        // THROWS. So this comparator did not merely mis-sort on an ISO createdAt,
        // it threw inside the sort and the whole action fell into its catch.
        const allDocs = snapshot.docs.sort((a, b) => { const tA = toMillis(a.data().createdAt) || toMillis(a.data().bookedAt);
             const tB = toMillis(b.data().createdAt) || toMillis(b.data().bookedAt);
             return tB - tA;
        });

        const investments = await Promise.all(allDocs.map(async (doc) => { const data = doc.data();
            // Fetch window details for display safely
            let windowTitle = data.windowTitle || "Export Investment";
            if (data.windowId) {
                 const windowDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.windowId).get();
                 if (windowDoc.exists) {
                     const windowData = windowDoc.data()!;
                     windowTitle = windowData.title || windowData.commodity || windowTitle;
                 }
            }

            return { id: doc.id,
                ...data,
                windowTitle,
                createdAt: data.createdAt?.toDate() || data.bookedAt?.toDate() || new Date() };
        }));

        return { error: null, success: true as const, data: investments };
    } catch (error) { logger.error("Get my investments error:", error);
        return { success: false as const, error: "Failed to fetch investments"};
    }
}


/**
 * Extend Escrow Period (Admin Only)
 * Used when shipping delays or disputes occur
 */
export async function extendEscrowAction(
    exportId: string,
    days: number,
    reason: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error || "Session expired"};
        const { session } = sessionResult;
        // Check admin role
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) { return { success: false as const, error: "Unauthorized"};
        }

        const exportRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(exportId);
        const exportDoc = await exportRef.get();

        if (!exportDoc.exists) { return { success: false as const, error: "Export window not found"};
        }

        const currentReleaseDate = exportDoc.data()?.escrowReleaseDate?.toDate() || new Date();
        const newReleaseDate = new Date(currentReleaseDate);
        newReleaseDate.setDate(newReleaseDate.getDate() + days);

        await exportRef.update({ escrowReleaseDate: newReleaseDate,
            updatedAt: FieldValue.serverTimestamp(),
            // We might want to track extensions in a subcollection or array, but for now just audit log
        });

        // 📜 Audit Log
        const { logAuditAction } = await import("@/lib/audit-log");
        await logAuditAction({
            userId: session.user.id,
            action: "EXTEND_ESCROW",
            details: `Extended escrow for ${exportId} by ${days} days. Reason: ${reason}`,
            metadata: { exportId, days, reason, oldDate: currentReleaseDate, newDate: newReleaseDate }
        });

        return { error: null,  success: true as const , data: { message: "Escrow extended" } };
    } catch (error: any) { logger.error("Extend escrow error:", error);
        return { success: false as const, error: error.message};
    }
}
