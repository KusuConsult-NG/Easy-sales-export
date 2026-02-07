import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

/**
 * API Route: Get All Loan Products
 * Public endpoint - no auth required to view products
 */
export async function GET(request: NextRequest) {
    try {
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
