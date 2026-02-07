import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";

/**
 * API Route: Get All Land Listings
 * Returns verified listings for public viewing
 */
export async function GET(request: NextRequest) {
    try {
        // Get all verified land listings
        const listingsRef = collection(db, "land_listings");
        const q = query(
            listingsRef,
            where("verificationStatus", "==", "verified"),
            orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);

        const listings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date(),
            updatedAt: doc.data().updatedAt?.toDate?.() || new Date(),
        }));

        return NextResponse.json({
            success: true,
            listings
        });
    } catch (error) {
        console.error("Failed to fetch listings:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
