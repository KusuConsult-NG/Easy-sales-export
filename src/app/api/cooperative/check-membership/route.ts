import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * API Route: Check Cooperative Membership Status
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

        // Check if user is a member
        const membershipRef = doc(db, "cooperative_members", userId);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            return NextResponse.json({
                success: true,
                isMember: false,
                status: "not_member"
            });
        }

        const membershipData = membershipDoc.data();

        return NextResponse.json({
            success: true,
            isMember: true,
            status: membershipData.membershipStatus || "pending",
            data: membershipData
        });
    } catch (error) {
        console.error("Failed to check membership:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
