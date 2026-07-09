export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * GET /api/admin/verify-id/lookup
 * Lookup a member by memberNumber or email for admin ID verification
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ found: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return NextResponse.json({ found: false, error: "Admin access required" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const type = searchParams.get("type"); // "memberNumber" | "email"
        const query = searchParams.get("query")?.trim();

        if (!type || !query) {
            return NextResponse.json({ found: false, error: "Missing type or query" }, { status: 400 });
        }

        let userDoc: any | any | null = null;
        let memberDoc: any | null = null;

        if (type === "email") {
            // Look by email in users collection
            const usersSnap = await db.collection(COLLECTIONS.USERS).where("email", "==", query).limit(1).get();
            if (!usersSnap.empty) {
                userDoc = usersSnap.docs[0];
            }
        } else if (type === "memberNumber") {
            // Look in cooperative_members by memberNumber
            const memberSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("memberNumber", "==", query)
                .limit(1)
                .get();
            if (!memberSnap.empty) {
                memberDoc = memberSnap.docs[0];
                // Get the user doc
                const membData = memberDoc.data();
                if (membData?.userId) {
                    const userSnap = await db.collection(COLLECTIONS.USERS).doc(membData.userId).get();
                    if (userSnap.exists) {
                        userDoc = userSnap;
                    }
                }
            }
        }

        if (!userDoc) {
            return NextResponse.json({ found: false, error: `No member found with that ${type === "email" ? "email" : "member number"}.` });
        }

        const userData = userDoc.data()!;
        const membData = memberDoc?.data();

        // Compose member profile
        const member = {
            id: userDoc.id,
            fullName: userData.fullName || userData.name ||
                `${membData?.firstName || ""} ${membData?.lastName || ""}`.trim() || "Unknown",
            email: userData.email || membData?.email || "",
            memberNumber: membData?.memberNumber || userData.memberNumber || "—",
            role: (userData.roles || []).join(", ") || "member",
            status: membData?.status || membData?.membershipStatus || userData.status || "unknown",
            paymentStatus: membData?.paymentStatus || undefined,
            membershipTier: membData?.membershipTier || undefined,
            joinedAt: membData?.createdAt
                ? (membData.createdAt.toDate ? membData.createdAt.toDate().toISOString() : String(membData.createdAt))
                : (userData.createdAt?.toDate ? userData.createdAt.toDate().toISOString() : undefined),
        };

        return NextResponse.json({ found: true, member });
    } catch (error) {
        logger.error("Member lookup failed:", error);
        return NextResponse.json({ found: false, error: "Internal server error" }, { status: 500 });
    }
}
