import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";

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
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Get all seller verifications (Admin SDK)
        const snapshot = await db.collection("seller_verifications")
            .orderBy("createdAt", "desc")
            .get();

        const verifications = await Promise.all(
            snapshot.docs.map(async (verDoc) => {
                const data = verDoc.data();

                // Get user details
                const userDoc = await db.collection("users").doc(data.userId).get();
                const userData = userDoc.exists ? userDoc.data() : {};

                return {
                    id: verDoc.id,
                    ...data,
                    userName: userData?.name || userData?.email || "Unknown User",
                    userEmail: userData?.email || "",
                    createdAt: data.createdAt?.toDate?.() || new Date(),
                };
            })
        );

        return NextResponse.json({
            success: true,
            verifications
        });
    } catch (error) {
        logger.error("Failed to fetch seller verifications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
