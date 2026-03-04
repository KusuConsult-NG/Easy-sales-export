export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";

/**
 * API Route: Check WAVE Eligibility and Application Status
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

        // Get user profile for gender (Admin SDK)
        const userDoc = await db.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            return NextResponse.json({
                success: false,
                message: "User profile not found"
            }, { status: 404 });
        }

        const userData = userDoc.data()!;
        const gender = userData.gender || null;

        // Check WAVE application status (Admin SDK)
        const waveDoc = await db.collection("wave_applications").doc(userId).get();

        let applicationStatus = "not_applied";
        if (waveDoc.exists) {
            const waveData = waveDoc.data()!;
            applicationStatus = waveData.status || "pending";
        }

        return NextResponse.json({
            success: true,
            gender,
            applicationStatus,
            eligible: gender === "female"
        });
    } catch (error) {
        logger.error("Failed to check WAVE eligibility:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
