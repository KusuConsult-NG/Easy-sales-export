export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { withRateLimit } from "@/lib/rate-limit";

/**
 * API Route: Submit Loan Application
 * Rate-limited to prevent duplicate/spam submissions.
 */
async function applyLoanHandler(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const body = await request.json();
        const { productId, amount, purpose, guarantorName, guarantorPhone, guarantorEmail, guarantorRelationship } = body;

        // Validate inputs
        if (!productId || !amount || !purpose || !guarantorName || !guarantorPhone) {
            return NextResponse.json(
                { success: false, message: "Missing required fields (including guarantor name and phone)" },
                { status: 400 }
            );
        }

        // Check membership status (Admin SDK)
        const membershipDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();

        if (!membershipDoc.exists) {
            return NextResponse.json(
                { success: false, message: "You must be a cooperative member to apply for loans" },
                { status: 403 }
            );
        }

        const membershipData = membershipDoc.data()!;

        // Check membership status - must be active (not just approved)
        if (membershipData.membershipStatus !== "active") {
            return NextResponse.json(
                { success: false, message: "Your membership must be active before applying for loans. Please complete registration payment." },
                { status: 403 }
            );
        }


        // Get loan product details (Admin SDK)
        const productDoc = await db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId).get();

        if (!productDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Loan product not found" },
                { status: 404 }
            );
        }

        const product = productDoc.data()!;

        // Validate amount range
        if (amount < product.minAmount || amount > product.maxAmount) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Loan amount must be between ₦${product.minAmount.toLocaleString()} and ₦${product.maxAmount.toLocaleString()}`
                },
                { status: 400 }
            );
        }

        // ELIGIBILITY CHECK #1: Check savings requirement (must have 2x loan amount in savings)
        const totalSavings = membershipData.totalContributions || 0;
        const requiredSavings = amount * 2;

        if (totalSavings < requiredSavings) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Insufficient savings. You need at least ₦${requiredSavings.toLocaleString()} in contributions (2x loan amount). Current savings: ₦${totalSavings.toLocaleString()}`
                },
                { status: 403 }
            );
        }

        // ELIGIBILITY CHECK #2: Check for existing active loans (Admin SDK)
        const existingLoansSnapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("userId", "==", userId)
            .where("status", "in", ["pending", "approved", "active"])
            .get();

        if (!existingLoansSnapshot.empty) {
            return NextResponse.json(
                {
                    success: false,
                    message: "You already have an active or pending loan. Please clear existing loans before applying for a new one."
                },
                { status: 403 }
            );
        }

        // ELIGIBILITY CHECK #3: Check payment status (no outstanding debts)
        if (membershipData.paymentStatus !== "completed") {
            return NextResponse.json(
                {
                    success: false,
                    message: "Your membership payment is not complete. Please settle all outstanding payments before applying for loans."
                },
                { status: 403 }
            );
        }

        // Calculate monthly payment (simple calculation)
        const monthlyRate = product.interestRate / 100 / 12;
        const monthlyPayment = (amount * monthlyRate * Math.pow(1 + monthlyRate, product.durationMonths)) /
            (Math.pow(1 + monthlyRate, product.durationMonths) - 1);

        // Create loan application (Admin SDK)
        const applicationRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc();
        const applicationData = {
            userId,
            productId,
            productName: product.name,
            amount,
            purpose,
            interestRate: product.interestRate,
            durationMonths: product.durationMonths,
            monthlyPayment: Math.round(monthlyPayment),
            status: "pending",
            guarantorName: guarantorName.trim(),
            guarantorPhone: guarantorPhone.trim(),
            guarantorEmail: guarantorEmail?.trim() || "",
            guarantorRelationship: guarantorRelationship || "",
            guarantorVerified: false,
            appliedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        };

        await applicationRef.set(applicationData);

        return NextResponse.json({
            success: true,
            message: "Loan application submitted successfully",
            applicationId: applicationRef.id,
            data: {
                ...applicationData,
                appliedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            }
        });
    } catch (error) {
        logger.error("Failed to submit loan application:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(applyLoanHandler);
