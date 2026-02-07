import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";

/**
 * API Route: Get User's Loan Applications
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

        // Get all applications for this user
        const applicationsRef = collection(db, "loan_applications");
        const q = query(
            applicationsRef,
            where("userId", "==", userId),
            orderBy("appliedAt", "desc")
        );
        const snapshot = await getDocs(q);

        const applications = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                appliedAt: data.appliedAt?.toDate?.() || new Date(),
            };
        });

        return NextResponse.json({
            success: true,
            applications
        });
    } catch (error) {
        console.error("Failed to fetch loan applications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
