import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
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

        const userDocRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            // Create user document with onboarding completed
            await userDocRef.set({
                id: session.user.id,
                email: session.user.email,
                onboardingCompleted: true,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        } else {
            // Update existing document
            await userDocRef.update({
                onboardingCompleted: true,
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        return NextResponse.json({
            success: true,
            message: "Onboarding marked complete",
        });
    } catch (error: any) {
        logger.error("Onboarding completion error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to mark complete", details: error.message },
            { status: 500 }
        );
    }
}
