import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

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

        // Check if user is admin or super_admin
        const roles = session.user.roles || [];
        if (!roles.includes("admin") && !roles.includes("super_admin")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const limitParam = parseInt(searchParams.get("limit") || "50");
        const lastCreatedAt = searchParams.get("lastCreatedAt");
        const status = searchParams.get("status");

        // Build query using Admin SDK
        let query: FirebaseFirestore.Query = db.collection("cooperative_members")
            .orderBy("createdAt", "desc");

        if (status && status !== "all") {
            query = db.collection("cooperative_members")
                .where("membershipStatus", "==", status)
                .orderBy("createdAt", "desc");
        }

        if (lastCreatedAt) {
            const cursorDate = new Date(lastCreatedAt);
            query = query.startAfter(cursorDate);
        }

        query = query.limit(limitParam);

        const snapshot = await query.get();

        const members = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date(),
        }));

        const hasMore = members.length === limitParam;
        const newLastCreatedAt = members.length > 0 ? members[members.length - 1].createdAt : undefined;

        return NextResponse.json({
            success: true,
            members,
            hasMore,
            lastCreatedAt: newLastCreatedAt
        });
    } catch (error) {
        logger.error("Failed to fetch members:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
