import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

// Rate limiter for payment verification (prevent fraud/double-verification)
const paymentVerifyLimiter = rateLimit(rateLimitConfig.payment);

/**
 * API Route: Verify Paystack Payment for Cooperative Membership
 * 
 * This endpoint verifies the payment with Paystack and updates the membership record
 */
export async function POST(request: NextRequest) {
    // RATE LIMITING - Prevent payment verification abuse
    const clientIp = getClientIp(request);
    const rateLimitResult = await paymentVerifyLimiter.check(clientIp);

    if (!rateLimitResult.success) {
        return createRateLimitResponse(rateLimitResult);
    }

    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const { reference } = await request.json();

        if (!reference) {
            return NextResponse.json(
                { success: false, message: "Payment reference is required" },
                { status: 400 }
            );
        }

        // Verify payment with Paystack
        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return NextResponse.json(
                { success: false, message: "Payment system not configured" },
                { status: 500 }
            );
        }

        const verifyResponse = await fetch(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${paystackSecretKey}`,
                },
            }
        );

        if (!verifyResponse.ok) {
            return NextResponse.json(
                { success: false, message: "Failed to verify payment" },
                { status: 400 }
            );
        }

        const verifyData = await verifyResponse.json();

        if (!verifyData.status || verifyData.data.status !== "success") {
            return NextResponse.json(
                { success: false, message: "Payment not successful" },
                { status: 400 }
            );
        }

        // Update membership record
        const userId = session.user.id;
        const membershipRef = doc(db, "cooperative_members", userId);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Membership record not found" },
                { status: 404 }
            );
        }

        const membershipData = membershipDoc.data();
        const tier = membershipData.membershipTier || "basic";
        const expectedAmount = tier === "premium" ? 20000 : 10000;
        const paidAmount = verifyData.data.amount / 100; // Paystack amount is in kobo

        // 🔒 SECURITY FIX: Validate Amount
        // Allow 1 naira variance for potential rounding issues, though unlikely with Paystack
        if (paidAmount < expectedAmount - 1) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Insufficient payment amount. Expected ₦${expectedAmount.toLocaleString()}, received ₦${paidAmount.toLocaleString()}`
                },
                { status: 400 }
            );
        }

        // Update payment status
        await updateDoc(membershipRef, {
            paymentStatus: "completed",
            paymentVerifiedAt: new Date(),
            updatedAt: new Date(),
            // Ensure savings/loan balances are initialized if not already
            savingsBalance: membershipData.savingsBalance || 0,
            loanBalance: membershipData.loanBalance || 0,
        });

        return NextResponse.json({
            success: true,
            message: "Payment verified successfully. Your application is pending approval.",
        });
    } catch (error) {
        logger.error("Payment verification error:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
