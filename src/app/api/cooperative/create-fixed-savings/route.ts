export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

/**
 * API Route: Create Fixed Savings Plan
 * Uses a Firestore transaction for atomic balance deduction & plan creation
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const { amount, durationMonths } = await request.json();

        // Validation
        if (!amount || amount < 50000) {
            return NextResponse.json(
                { success: false, message: "Minimum amount is ₦50,000" },
                { status: 400 }
            );
        }

        if (!durationMonths || durationMonths < 1 || durationMonths > 12) {
            return NextResponse.json(
                { success: false, message: "Duration must be between 1 and 12 months" },
                { status: 400 }
            );
        }

        // Check if user is an approved cooperative member
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const memberDoc = await memberRef.get();

        if (!memberDoc.exists) {
            return NextResponse.json(
                { success: false, message: "You must be a cooperative member to create fixed savings" },
                { status: 403 }
            );
        }

        const memberData = memberDoc.data()!;
        if (memberData.membershipStatus !== "approved" && memberData.membershipStatus !== "active") {
            return NextResponse.json(
                { success: false, message: "Your membership must be approved first" },
                { status: 403 }
            );
        }

        // Calculate interest and maturity
        const interestRate = 14; // 14% annual interest for fixed savings
        const projectedProfit = (amount * interestRate * (durationMonths / 12)) / 100;

        // 🔒 SECURITY FIX: Use Admin SDK Transaction for Atomic Balance Deduction & Plan Creation
        const result = await db.runTransaction(async (transaction) => {
            // Re-read member doc within transaction
            const freshMemberDoc = await transaction.get(memberRef);
            if (!freshMemberDoc.exists) {
                throw new Error("Member not found");
            }

            const userData = freshMemberDoc.data()!;
            const currentBalance = userData.savingsBalance || 0;

            if (currentBalance < amount) {
                throw new Error(`Insufficient savings balance. You have ₦${currentBalance.toLocaleString()} but need ₦${amount.toLocaleString()}. Please contribute more funds first.`);
            }

            // Deduct from savings balance
            transaction.update(memberRef, {
                savingsBalance: currentBalance - amount,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Create fixed savings plan
            const planRef = db.collection(COLLECTIONS.FIXED_SAVINGS_PLANS).doc();
            transaction.set(planRef, {
                memberId: userId,
                amount,
                startDate: FieldValue.serverTimestamp(),
                maturityDate: new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000),
                durationMonths,
                interestRate,
                projectedProfit,
                status: "active",
                createdAt: FieldValue.serverTimestamp(),
            });

            // Create transaction record
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc();
            transaction.set(txRef, {
                userId,
                type: "fixed_savings_funding",
                amount,
                description: `Funded ${durationMonths}-month fixed savings plan`,
                status: "completed",
                date: FieldValue.serverTimestamp(),
            });

            return planRef.id;
        });

        return NextResponse.json({
            success: true,
            message: "Fixed savings plan created successfully",
            planId: result,
        });
    } catch (error: any) {
        logger.error("Failed to create fixed savings plan:", error);

        // Handle custom errors from transaction
        if (error instanceof Error) {
            return NextResponse.json(
                { success: false, message: error.message },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
