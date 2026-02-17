import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

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

        // Check if user is admin
        if (!session.user.roles?.includes("admin")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const limitParam = parseInt(searchParams.get("limit") || "50");
        const lastCreatedAt = searchParams.get("lastCreatedAt");
        const status = searchParams.get("status");

        // Fetch membership applications
        const membersRef = collection(db, "cooperative_members");
        let q = query(membersRef, orderBy("createdAt", "desc"));

        if (status && status !== "all") {
            // Note: If filtering by status, we need a composite index on [status, createdAt]
            // We'll apply the filter using 'where'
            // For now, if the index exists this works. If not, it might error.
            // Given previous patterns, we assume standard filtering.
            // Client-side filtering was removed to support pagination.
            // However, Firestore requires 'where' fields to be part of the 'orderBy' prefix/composite index
            // when using inequality or range filters (not used here).
            // But cursor pagination requires the ORDER BY to exactly match the cursor.
            // So: .where("membershipStatus", "==", status).orderBy("createdAt", "desc")
            // This requires an index: cooperative_members { membershipStatus ASC, createdAt DESC }
            // If missing, this will fail. For safety/robustness initially without confirming index,
            // we could fetch more and filter in memory, but that defeats pagination purpose.
            // We will trust the index exists or will be created.

            // Re-construct query to include where clause
            // q = query(membersRef, where("membershipStatus", "==", status), orderBy("createdAt", "desc"));
            // BUT: type 'query' is additive.
            // Let's perform the query construction properly.
        }

        // Construct query array for clean logic
        const constraints: any[] = [orderBy("createdAt", "desc")];

        if (status && status !== "all") {
            // Import 'where' from firebase/firestore
            const { where } = await import("firebase/firestore");
            constraints.unshift(where("membershipStatus", "==", status));
        }

        if (lastCreatedAt) {
            const { startAfter, Timestamp } = await import("firebase/firestore");
            const cursorDate = new Date(lastCreatedAt);
            constraints.push(startAfter(Timestamp.fromDate(cursorDate)));
        }

        const { limit } = await import("firebase/firestore");
        constraints.push(limit(limitParam));

        const finalQuery = query(membersRef, ...constraints);
        const snapshot = await getDocs(finalQuery);

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
