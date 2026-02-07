import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

/**
 * API Route: Get All Cooperative Membership Applications (Admin)
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
        // TODO: Add proper admin role check
        const isAdmin = session.user.email?.endsWith("@easysalesexport.com") ||
            session.user.roles?.includes("admin");

        if (!isAdmin) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Fetch all membership applications
        const membersRef = collection(db, "cooperative_members");
        const q = query(membersRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        const members = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date(),
        }));

        return NextResponse.json({
            success: true,
            members,
        });
    } catch (error) {
        console.error("Failed to fetch members:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
