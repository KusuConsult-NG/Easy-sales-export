import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, doc, getDoc } from "firebase/firestore";

/**
 * API Route: Get All Seller Verifications (Admin Only)
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

        // Get all seller verifications
        const verificationsRef = collection(db, "seller_verifications");
        const q = query(verificationsRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        const verifications = await Promise.all(
            snapshot.docs.map(async (verDoc) => {
                const data = verDoc.data();

                // Get user details
                const userRef = doc(db, "users", data.userId);
                const userDoc = await getDoc(userRef);
                const userData = userDoc.exists() ? userDoc.data() : {};

                return {
                    id: verDoc.id,
                    ...data,
                    userName: userData.name || userData.email || "Unknown User",
                    userEmail: userData.email || "",
                    createdAt: data.createdAt?.toDate?.() || new Date(),
                };
            })
        );

        return NextResponse.json({
            success: true,
            verifications
        });
    } catch (error) {
        console.error("Failed to fetch seller verifications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
