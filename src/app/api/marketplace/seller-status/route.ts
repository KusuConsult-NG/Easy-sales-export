import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * API Route: Check Marketplace Seller Status
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

        // Check seller verification status
        const sellerRef = doc(db, "marketplace_sellers", userId);
        const sellerDoc = await getDoc(sellerRef);

        if (!sellerDoc.exists()) {
            return NextResponse.json({
                success: true,
                status: "not_verified",
                message: "Not yet verified as a seller"
            });
        }

        const sellerData = sellerDoc.data();

        return NextResponse.json({
            success: true,
            status: sellerData.verificationStatus || "pending",
            data: sellerData
        });
    } catch (error) {
        console.error("Failed to check seller status:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
