import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Check MFA status for current user
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, session.user.id));

        if (!userDoc.exists()) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        const userData = userDoc.data();

        return NextResponse.json({
            success: true,
            enabled: userData.mfaEnabled || false,
        });
    } catch (error: any) {
        console.error("MFA status check error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to check status" },
            { status: 500 }
        );
    }
}
