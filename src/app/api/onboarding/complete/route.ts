import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, updateDoc, getDoc, setDoc } from "firebase/firestore";
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

        const userDocRef = doc(db, COLLECTIONS.USERS, session.user.id);
        const userDoc = await getDoc(userDocRef);

        // If user document doesn't exist, create it with onboarding completed
        if (!userDoc.exists()) {
            await setDoc(userDocRef, {
                id: session.user.id,
                email: session.user.email,
                onboardingCompleted: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            }, { merge: true });
        } else {
            // Update existing document
            await updateDoc(userDocRef, {
                onboardingCompleted: true,
                updatedAt: new Date(),
            });
        }

        return NextResponse.json({
            success: true,
            message: "Onboarding marked complete",
        });
    } catch (error: any) {
        console.error("Onboarding completion error:", error);
        console.error("Error details:", {
            code: error.code,
            message: error.message,
            stack: error.stack,
        });

        return NextResponse.json(
            {
                success: false,
                error: "Failed to mark complete",
                details: error.message // Include error message for debugging
            },
            { status: 500 }
        );
    }
}
