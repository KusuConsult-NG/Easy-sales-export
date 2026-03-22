export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * API Route: Get All Loan Applications (Admin Only)
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

        // Check if user is admin or super_admin
        const roles = session.user.roles || [];
        if (!roles.includes("admin") && !roles.includes("super_admin")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Get all loan applications (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .orderBy("appliedAt", "desc")
            .get();

        const applications = await Promise.all(
            snapshot.docs.map(async (appDoc) => {
                const data = appDoc.data();

                // Get user details
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(data.userId).get();
                const userData = userDoc.exists ? userDoc.data() : {};

                return {
                    id: appDoc.id,
                    ...data,
                    userName: userData?.name || userData?.email || "Unknown User",
                    userEmail: userData?.email || "",
                    appliedAt: data.appliedAt?.toDate?.() || new Date(),
                };
            })
        );

        return NextResponse.json({
            success: true,
            applications
        });
    } catch (error) {
        logger.error("Failed to fetch loan applications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
