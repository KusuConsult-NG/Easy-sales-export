import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, addDoc, doc, getDoc } from "firebase/firestore";

/**
 * API Route: Create Fixed Savings Plan
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
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
        const memberRef = doc(db, "cooperative_members", userId);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "You must be a cooperative member to create fixed savings" },
                { status: 403 }
            );
        }

        const memberData = memberDoc.data();
        if (memberData.membershipStatus !== "approved") {
            return NextResponse.json(
                { success: false, message: "Your membership must be approved first" },
                { status: 403 }
            );
        }

        // Calculate interest and maturity
        const interestRate = 10; // 10% annual interest for fixed savings
        const projectedProfit = (amount * interestRate * (durationMonths / 12)) / 100;

        const startDate = new Date();
        const maturityDate = new Date();
        maturityDate.setMonth(maturityDate.getMonth() + durationMonths);

        // 🔒 SECURITY FIX: Use Transaction for Atomic Balance Deduction & Plan Creation
        const { runTransaction, serverTimestamp } = await import('firebase/firestore');
        const { COLLECTIONS } = await import('@/lib/types/firestore');

        const result = await runTransaction(db, async (transaction) => {
            // Re-read member doc within transaction
            const freshMemberDoc = await transaction.get(memberRef);
            if (!freshMemberDoc.exists()) {
                throw "Member not found";
            }

            const userData = freshMemberDoc.data();
            const currentBalance = userData.savingsBalance || 0;

            if (currentBalance < amount) {
                throw `Insufficient savings balance. You have ₦${currentBalance.toLocaleString()} but need ₦${amount.toLocaleString()}. Please contribute more funds first.`;
            }

            // Deduct from savings balance
            transaction.update(memberRef, {
                savingsBalance: currentBalance - amount,
                updatedAt: serverTimestamp()
            });

            // Create fixed savings plan
            const planRef = doc(collection(db, "fixed_savings_plans"));
            transaction.set(planRef, {
                memberId: userId,
                amount,
                startDate: serverTimestamp(), // Use server timestamp
                maturityDate: new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000), // Approx match
                durationMonths,
                interestRate,
                projectedProfit,
                status: "active",
                createdAt: serverTimestamp(),
            });

            // Create transaction record
            const txRef = doc(collection(db, "transactions"));
            transaction.set(txRef, {
                userId,
                type: "fixed_savings_funding",
                amount,
                description: `Funded ${durationMonths}-month fixed savings plan`,
                status: "completed",
                date: serverTimestamp(),
            });

            return planRef.id;
        });

        return NextResponse.json({
            success: true,
            message: "Fixed savings plan created successfully",
            planId: result,
        });
    } catch (error: any) {
        console.error("Failed to create fixed savings plan:", error);

        // Handle custom errors
        if (typeof error === 'string') {
            return NextResponse.json(
                { success: false, message: error },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
