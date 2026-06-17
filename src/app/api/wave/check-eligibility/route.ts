export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * GET /api/wave/check-eligibility
 * Check WAVE eligibility and application status for the authenticated user.
 *
 * Response: { success, data: { gender, applicationStatus, eligible }, meta: { cursor: null, hasMore: false } }
 */
export async function GET(_request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: { cursor: null, hasMore: false } },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, data: null, error: "User profile not found", meta: { cursor: null, hasMore: false } },
                { status: 404 }
            );
        }

        const userData = userDoc.data()!;
        const gender: string | null = userData.gender || null;
        const roles: string[] = userData.roles || [];
        const isUserAdmin = roles.includes("admin") || roles.includes("super_admin");
        const academyReg = userData.serviceRegistrations?.academy;
        const isAcademyElite = academyReg?.plan === 'elite' && (academyReg?.status === 'approved' || academyReg?.status === 'active');
        const hasWaveRole = roles.includes("wave_participant");
        const hasWaveReg = userData.serviceRegistrations?.wave?.status !== undefined;

        const isMale = gender?.toLowerCase() === "male";
        const userCreatedAt = userData.createdAt;
        const CUTOFF_DATE = new Date("2026-06-17T00:00:00.000Z");
        let registeredOnOrAfterCutoff = false;
        if (userCreatedAt) {
            const dateVal = typeof userCreatedAt.toDate === "function" 
                ? userCreatedAt.toDate() 
                : (userCreatedAt.seconds ? new Date(userCreatedAt.seconds * 1000) : new Date(userCreatedAt));
            registeredOnOrAfterCutoff = dateVal >= CUTOFF_DATE;
        }
        const isNewMaleUser = isMale && registeredOnOrAfterCutoff;

        const isWaveBlocked = isMale && (isNewMaleUser || (!hasWaveRole && !hasWaveReg));
        const eligible = !isWaveBlocked || isUserAdmin || isAcademyElite;

        // Check application status from user's serviceRegistrations (single source of truth)
        const applicationStatus: string =
            userData.serviceRegistrations?.wave?.status || "not_applied";

        return NextResponse.json({
            success: true,
            data: {
                gender,
                applicationStatus,
                eligible,
            },
            meta: { cursor: null, hasMore: false },
        });
    } catch (error) {
        logger.error("GET /api/wave/check-eligibility error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Internal server error", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}
