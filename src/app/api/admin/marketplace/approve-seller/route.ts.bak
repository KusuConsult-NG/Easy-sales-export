import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

/**
 * API Route: Approve Seller Verification (Admin Only)
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

        const { verificationId } = await request.json();

        if (!verificationId) {
            return NextResponse.json(
                { success: false, message: "Verification ID is required" },
                { status: 400 }
            );
        }

        // Get verification
        const verificationRef = doc(db, "seller_verifications", verificationId);
        const verificationDoc = await getDoc(verificationRef);

        if (!verificationDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Verification not found" },
                { status: 404 }
            );
        }

        const verificationData = verificationDoc.data();

        // Update verification status
        await updateDoc(verificationRef, {
            status: "approved",
            reviewedAt: new Date(),
            reviewedBy: session.user.id,
            updatedAt: new Date(),
        });

        // Update marketplace_sellers record
        const sellerRef = doc(db, "marketplace_sellers", verificationData.userId);
        await updateDoc(sellerRef, {
            verificationStatus: "approved",
            businessName: verificationData.businessName,
            rating: 0,
            totalSales: 0,
            approvedAt: new Date(),
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Seller approved successfully"
        });
    } catch (error) {
        console.error("Failed to approve seller:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
