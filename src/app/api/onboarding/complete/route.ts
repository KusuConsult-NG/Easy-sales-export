import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Mark onboarding as complete
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        await updateDoc(doc(db, COLLECTIONS.USERS, session.user.id), {
            onboardingCompleted: true,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Onboarding marked complete",
        });
    } catch (error: any) {
        console.error("Onboarding completion error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to mark complete" },
            { status: 500 }
        );
    }
}
