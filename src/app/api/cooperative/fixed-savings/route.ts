import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";

/**
 * API Route: Get User's Fixed Savings Plans
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Fetch user's fixed savings plans (Admin SDK)
        const snapshot = await db.collection("fixed_savings_plans")
            .where("memberId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const plans = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                startDate: data.startDate?.toDate?.() || new Date(),
                maturityDate: data.maturityDate?.toDate?.() || new Date(),
                createdAt: data.createdAt?.toDate?.() || new Date(),
            };
        });

        return NextResponse.json({
            success: true,
            plans,
        });
    } catch (error) {
        logger.error("Failed to fetch fixed savings plans:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
