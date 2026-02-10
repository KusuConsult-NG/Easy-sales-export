import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, query, getDocs, orderBy, doc, getDoc } from "firebase/firestore";

/**
 * API Route: Get All Land Verifications (Admin)
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

        // Check admin role
        const userRef = doc(db, "users", session.user.id);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Get all land listings
        const listingsRef = collection(db, "land_listings");
        const q = query(listingsRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        const verifications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date(),
            updatedAt: doc.data().updatedAt?.toDate?.() || new Date(),
        }));

        return NextResponse.json({
            success: true,
            verifications
        });
    } catch (error) {
        console.error("Failed to fetch verifications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
