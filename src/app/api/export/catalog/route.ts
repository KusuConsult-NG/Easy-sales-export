import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const db = getAdminDb();
        const snapshot = await db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("isActive", "==", true)
            .get();

        const products = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return NextResponse.json({
            success: true,
            products
        });
    } catch (error) {
        console.error("Export catalog fetch error:", error);
        return NextResponse.json({
            success: false,
            error: "Failed to fetch export catalog"
        }, { status: 500 });
    }
}
