import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, deleteDoc } from "firebase/firestore";

/**
 * API Route: Delete Loan Product (Admin Only)
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

        const { productId } = await request.json();

        if (!productId) {
            return NextResponse.json(
                { success: false, message: "Product ID is required" },
                { status: 400 }
            );
        }

        // Get product
        const productRef = doc(db, "loan_products", productId);
        const productDoc = await getDoc(productRef);

        if (!productDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Product not found" },
                { status: 404 }
            );
        }

        // Delete product
        await deleteDoc(productRef);

        return NextResponse.json({
            success: true,
            message: "Loan product deleted successfully"
        });
    } catch (error) {
        console.error("Failed to delete loan product:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
