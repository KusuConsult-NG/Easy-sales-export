import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

/**
 * API Route: Reject Loan Application (Admin Only)
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

        // Check if user is admin
        const userRef = doc(db, "users", session.user.id);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { applicationId, reason } = await request.json();

        if (!applicationId || !reason) {
            return NextResponse.json(
                { success: false, message: "Application ID and rejection reason are required" },
                { status: 400 }
            );
        }

        // Get application
        const applicationRef = doc(db, "loan_applications", applicationId);
        const applicationDoc = await getDoc(applicationRef);

        if (!applicationDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Application not found" },
                { status: 404 }
            );
        }

        // Update application status
        await updateDoc(applicationRef, {
            status: "rejected",
            rejectionReason: reason,
            rejectedAt: new Date(),
            rejectedBy: session.user.id,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Loan application rejected"
        });
    } catch (error) {
        console.error("Failed to reject loan:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
