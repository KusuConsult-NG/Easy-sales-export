export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { normalizeUserDoc } from "@/lib/schema-normalizer";
import { claimPaymentOnce } from "@/lib/wallet-ledger";

// Rate limiter for payment verification (prevent fraud/double-verification)
const paymentVerifyLimiter = rateLimit(rateLimitConfig.payment);

/**
 * Bring the membership and user docs into line with a payment that some OTHER
 * path already applied — the webhook, or an earlier delivery of this request.
 *
 * This is the second job the old `processedDoc.exists` pre-check was doing, and
 * it is real: a user whose webhook landed first must not be told "verification
 * failed" after paying. It now hangs off a LOST CLAIM, which knows for certain
 * the payment was already applied, rather than off a racy read that only
 * inferred it.
 */
async function syncAlreadyProcessed(userId: string, reference: string, amount: number | null) {
    const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
    await Promise.all([
        membershipRef.set({
            userId,
            paymentStatus: "completed",
            paymentReference: reference,
            membershipTier: "Member",
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        db.collection(COLLECTIONS.USERS).doc(userId).set({
            serviceRegistrations: {
                cooperatives: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: amount,
                    status: "legacy_pending_onboarding",
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
    ]);
}

/**
 * API Route: Verify Paystack Payment for Cooperative Membership
 *
 * Fully idempotent — calling this multiple times with the same reference always
 * returns success once Paystack has confirmed the payment.
 *
 * Uses set(merge:true) everywhere so the membership doc is CREATED if it was
 * never written by initiateCooperativePaymentAction (back button, direct link,
 * webhook race-condition, etc.).
 *
 * IDEMPOTENCY is claimPaymentOnce, not a read. This route used to decide whether
 * to fulfil by reading processed_payments and writing the marker afterwards —
 * the same client/webhook double-fulfilment fixed in the export, academy and
 * farm-nation paths. The re-read inside runTransaction looked like a guard and
 * was not: that wrapper takes no lock, so two deliveries in flight together both
 * read "absent" and both fulfilled.
 *
 * The writes here are nearly all keyed on the reference or the user id, so a
 * double run duplicated little. What it DID do is blind-set the
 * processed_payments row that processCooperativeRegistration had claimed,
 * overwriting claimedAt — the only evidence the webhook ran, and the signal
 * currently being used to investigate whether it fires at all. See
 * docs/audit/integrity-sweep-2026-08-10.md (F3).
 */
export async function POST(request: NextRequest) {
    const clientIp = getClientIp(request);
    const rateLimitResult = await paymentVerifyLimiter.check(clientIp);
    if (!rateLimitResult.success) {
        return createRateLimitResponse(rateLimitResult);
    }

    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        const { reference } = await request.json();
        if (!reference) {
            return NextResponse.json({ success: false, message: "Payment reference is required" }, { status: 400 });
        }

        const userId = session.user.id;
        const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

        // ── FAST PATH, not a guard ──────────────────────────────────────────────
        // This saves a Paystack round trip in the common case of a user
        // re-landing on the callback page. It is deliberately NOT the idempotency
        // mechanism — claimPaymentOnce below is. The companion read of
        // processed_payments that used to sit here is gone: it was the read half
        // of a check-then-write, and leaving it above the claim is exactly how it
        // came to be mistaken for protection in the first place.
        const membershipDoc = await membershipRef.get();

        if (membershipDoc.exists && membershipDoc.data()?.paymentStatus === "completed") {
            logger.info(`[Cooperative verify-payment] Membership already completed for ${userId}`);
            // FIX: Also ensure the USERS doc is synced (fast-path for future status checks)
            try {
                await db.collection(COLLECTIONS.USERS).doc(userId).set({
                    serviceRegistrations: {
                        cooperatives: { paymentStatus: "completed" }
                    }
                }, { merge: true });
            } catch (e) { /* non-fatal */ }
            return NextResponse.json({
                success: true,
                message: "Payment already verified. Please continue your application.",
                alreadyVerified: true,
                onboardingCompleted: membershipDoc.data()?.onboardingCompleted === true,
            });
        }

        // ── VERIFY WITH PAYSTACK ─────────────────────────────────────────────────
        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return NextResponse.json({ success: false, message: "Payment system not configured" }, { status: 500 });
        }

        const verifyResponse = await fetch(
            `https://api.paystack.co/transaction/verify/${reference}`,
            { headers: { Authorization: `Bearer ${paystackSecretKey}` } }
        );

        if (!verifyResponse.ok) {
            return NextResponse.json({ success: false, message: "Failed to verify payment with Paystack" }, { status: 400 });
        }

        const verifyData = await verifyResponse.json();

        if (!verifyData.status || verifyData.data?.status !== "success") {
            const payStatus = verifyData.data?.status || "unknown";
            logger.warn(`[Cooperative Payment] User ${userId} attempted verification with Paystack status: ${payStatus}`);
            return NextResponse.json(
                { success: false, message: `Payment is ${payStatus}. Please complete payment or use a different payment method.` },
                { status: 400 }
            );
        }

        const { COOPERATIVE_CONFIG } = await import('@/lib/constants');
        const expectedAmount = COOPERATIVE_CONFIG.registrationFee;
        const paidAmount = verifyData.data.amount / 100; // kobo → naira

        if (paidAmount < expectedAmount - 1) {
            return NextResponse.json(
                { success: false, message: `Insufficient payment. Expected ₦${expectedAmount.toLocaleString()}, received ₦${paidAmount.toLocaleString()}` },
                { status: 400 }
            );
        }

        let onboardingCompleted = false;

        // ── CLAIM THE PAYMENT, THEN FULFIL ──────────────────────────────────────
        // The claim is the gate. Exactly one caller — this route or the webhook's
        // processCooperativeRegistration — gets `claimed: true` for a reference,
        // and the loser does no fulfilment at all.
        //
        // status is left at its default "completed": this is money IN, so it is
        // revenue and platform_revenue_totals() should sum it. Same as the
        // webhook handler, so the row looks identical whichever side wins.
        const claim = await claimPaymentOnce({
            reference,
            userId,
            amount: paidAmount,
            type: "cooperative_membership_registration",
            source: "client_verify",
        });

        if (!claim.claimed) {
            // Already applied, by the webhook or by an earlier delivery. Per rule
            // 3 of the migration doc, that is a SUCCESS, not an error — the money
            // has moved. Sync the docs so the user is not told verification
            // failed after paying, then report success.
            logger.info(`[Cooperative verify-payment] Payment ${reference} already claimed for ${userId} — syncing.`);
            try {
                await syncAlreadyProcessed(userId, reference, paidAmount);
            } catch (e) {
                logger.warn(`[Cooperative verify-payment] Sync on lost claim failed (non-fatal):`, e as any);
            }
            const fresh = await membershipRef.get();
            return NextResponse.json({
                success: true,
                message: "Payment verified successfully. Please continue your application.",
                alreadyVerified: true,
                onboardingCompleted: fresh.exists && fresh.data()?.onboardingCompleted === true,
            });
        }

        // Fulfilment. The payment is claimed above, so this runs exactly once.
        //
        // The runTransaction wrapper that used to be here bought nothing: the
        // adapter queues the writes and flushes them one at a time after the
        // callback returns, with no isolation and no rollback. It only made the
        // reads inside it look protected when they were not.
        //
        // Uses set(merge:true) throughout so this succeeds even when the
        // membership doc was never created by initiateCooperativePaymentAction.
        await (async () => {
            const tMembershipDoc = await membershipRef.get();
            const existing = tMembershipDoc.exists ? (tMembershipDoc.data() ?? {}) : {};
            onboardingCompleted = existing.onboardingCompleted === true;

            // Upsert the membership doc (create if missing, merge if exists)
            await membershipRef.set({
                userId,
                membershipTier:    existing.membershipTier    || "Member",
                membershipStatus:  onboardingCompleted ? "active" : "pending",
                paymentStatus:     "completed",
                paymentReference:  reference,
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                savingsBalance:    existing.savingsBalance    ?? 0,
                loanBalance:       existing.loanBalance       ?? 0,
                createdAt:         existing.createdAt         || FieldValue.serverTimestamp(),
                updatedAt:         FieldValue.serverTimestamp(),
            }, { merge: true });

            // No processed_payments write here. claimPaymentOnce above already
            // wrote that row, and it owns it — this used to be a blind set() that
            // overwrote whatever the webhook's claim had recorded, including
            // claimedAt. That is the same mistake as the export path erasing the
            // webhook's revenue status, and the reason PR #58 stopped the webhook
            // writing over the rows its own handlers claim.

            // Sync user doc for middleware gating
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const userUpdatePayload: any = {
                serviceRegistrations: {
                    cooperatives: {
                        paymentStatus:    "completed",
                        paymentReference: reference,
                        paymentAmount:    paidAmount,
                        status:           onboardingCompleted ? "active" : "legacy_pending_onboarding",
                        paidAt:           FieldValue.serverTimestamp(),
                    }
                },
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (onboardingCompleted) {
                userUpdatePayload.roles = FieldValue.arrayUnion("cooperative_member");
                userUpdatePayload.isVerified = true;
                userUpdatePayload.serviceRegistrations.cooperatives.activatedAt = FieldValue.serverTimestamp();
            }

            await userRef.set(normalizeUserDoc(userUpdatePayload), { merge: true });

            // Ledger rows LAST, and both keyed on the reference so a retry
            // overwrites rather than duplicates. Ordering matches the webhook
            // handler: a crash part-way leaves a member recorded without a
            // ledger entry rather than a ledger entry with no member.

            // Global ledger
            await db.collection(COLLECTIONS.TRANSACTIONS).doc(reference).set({
                id:          reference,
                userId,
                type:        "membership_registration",
                module:      "cooperative",
                amount:      paidAmount,
                currency:    "NGN",
                status:      "completed",
                date:        FieldValue.serverTimestamp(),
                reference,
                description: "Cooperative membership registration fee",
            });

            // Cooperative-specific ledger
            await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc(reference).set({
                userId,
                cooperativeId: existing.cooperativeId || "default",
                type:          "membership_registration",
                amount:        paidAmount,
                date:          FieldValue.serverTimestamp(),
                status:        "completed",
                description:   "Membership Registration Fee",
                reference,
            });
        })();

        logger.info(`[Cooperative verify-payment] Successfully verified payment ${reference} for user ${userId}`);

        return NextResponse.json({
            success: true,
            message: "Payment verified successfully. Please continue your application.",
            onboardingCompleted,
        });

    } catch (error) {
        logger.error("[Cooperative verify-payment] Error:", error);
        return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
    }
}
