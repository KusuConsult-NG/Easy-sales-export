import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";

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

        // Fetch user's fixed savings plans
        const plansRef = collection(db, "fixed_savings_plans");
        const q = query(
            plansRef,
            where("memberId", "==", userId),
            orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);

        const plans = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            startDate: doc.data().startDate?.toDate?.() || new Date(),
            maturityDate: doc.data().maturityDate?.toDate?.() || new Date(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date(),
        }));

        return NextResponse.json({
            success: true,
            plans,
        });
    } catch (error) {
        console.error("Failed to fetch fixed savings plans:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
