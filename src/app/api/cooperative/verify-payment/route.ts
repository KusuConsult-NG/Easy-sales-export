export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { normalizeUserDoc } from "@/lib/schema-normalizer";

// Rate limiter for payment verification (prevent fraud/double-verification)
const paymentVerifyLimiter = rateLimit(rateLimitConfig.payment);

/**
 * API Route: Verify Paystack Payment for Cooperative Membership
 *
 * Fully idempotent — calling this multiple times with the same reference always
 * returns success once Paystack has confirmed the payment.
 *
 * Uses set(merge:true) everywhere so the membership doc is CREATED if it was
 * never written by initiateCooperativePaymentAction (back button, direct link,
 * webhook race-condition, etc.).
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
        const processedRef  = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        // ── IDEMPOTENCY: fast-path — return success if already processed ─────────
        const [membershipDoc, processedDoc] = await Promise.all([
            membershipRef.get(),
            processedRef.get(),
        ]);

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

        if (processedDoc.exists) {
            logger.info(`[Cooperative verify-payment] Payment ${reference} already in processed_payments for ${userId}`);
            // FIX: Sync both membership and USERS docs so the primary status check
            // is always populated after any code path (webhook vs callback race).
            try {
                const pData = processedDoc.data();
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
                                paymentAmount: pData?.amount ?? null,
                                status: "legacy_pending_onboarding",
                            }
                        },
                        updatedAt: FieldValue.serverTimestamp(),
                    }, { merge: true }),
                ]);
            } catch (e) {
                logger.warn(`[Cooperative verify-payment] Sync on early-return failed (non-fatal):`, e as any);
            }
            return NextResponse.json({
                success: true,
                message: "Payment verified successfully. Please continue your application.",
                alreadyVerified: true,
                onboardingCompleted: membershipDoc.exists && membershipDoc.data()?.onboardingCompleted === true,
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

        // ── ATOMIC TRANSACTION: upsert membership + mark processed ───────────────
        // IMPORTANT: Uses set(merge:true) so this succeeds even when the membership
        // doc was never created by initiateCooperativePaymentAction.
        await db.runTransaction(async (transaction) => {
            // Re-read inside transaction for strong consistency
            const tProcessedDoc = await transaction.get(processedRef);
            if (tProcessedDoc.exists) {
                // A concurrent call already handled it — skip all writes
                return;
            }

            const tMembershipDoc = await transaction.get(membershipRef);
            const existing = tMembershipDoc.exists ? (tMembershipDoc.data() ?? {}) : {};
            onboardingCompleted = existing.onboardingCompleted === true;

            // Upsert the membership doc (create if missing, merge if exists)
            transaction.set(membershipRef, {
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

            // Mark as processed (idempotency record)
            transaction.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId,
                amount:  paidAmount,
                type:    "cooperative_membership_registration",
                status:  "completed",
                reference,
            });

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

            transaction.set(userRef, normalizeUserDoc(userUpdatePayload), { merge: true });

            // Global ledger
            transaction.set(db.collection(COLLECTIONS.TRANSACTIONS).doc(reference), {
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
            transaction.set(db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc(reference), {
                userId,
                cooperativeId: existing.cooperativeId || "default",
                type:          "membership_registration",
                amount:        paidAmount,
                date:          FieldValue.serverTimestamp(),
                status:        "completed",
                description:   "Membership Registration Fee",
                reference,
            });
        });

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
