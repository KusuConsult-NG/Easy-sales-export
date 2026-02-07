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

        // Create fixed savings plan
        const plansRef = collection(db, "fixed_savings_plans");
        const planDoc = await addDoc(plansRef, {
            memberId: userId,
            amount,
            startDate,
            maturityDate,
            durationMonths,
            interestRate,
            projectedProfit,
            status: "active",
            createdAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Fixed savings plan created successfully",
            planId: planDoc.id,
        });
    } catch (error) {
        console.error("Failed to create fixed savings plan:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
