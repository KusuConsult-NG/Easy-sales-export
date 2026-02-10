import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, doc, getDoc } from "firebase/firestore";

/**
 * API Route: Get All Loan Products (Admin Only)
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

        // Check if user is admin
        const userRef = doc(db, "users", session.user.id);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Get all loan products
        const productsRef = collection(db, "loan_products");
        const q = query(productsRef, orderBy("minAmount", "asc"));
        const snapshot = await getDocs(q);

        const products = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return NextResponse.json({
            success: true,
            products
        });
    } catch (error) {
        console.error("Failed to fetch loan products:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
