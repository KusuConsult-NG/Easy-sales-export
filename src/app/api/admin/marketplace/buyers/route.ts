export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

export async function GET() {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json({ success: false, message: "Admin access required" }, { status: 403 });
        }

        // We fetch users who have explicitly chosen to be buyers or sellers.
        // Easiest is to scan the users collection for marketplace roles or service registrations
        const snapshot = await db.collection(COLLECTIONS.USERS).get();
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const marketplaceUsers = users.filter((u: any) => {
            const hasSellerRole = (u.roles || []).includes("seller");
            const hasBuyerRole = (u.roles || []).includes("buyer");
            const isRegisteredInMarketplace = u.serviceRegistrations?.marketplace === true;
            return hasSellerRole || hasBuyerRole || isRegisteredInMarketplace;
        }).map((u: any) => {
            const hasSellerRole = (u.roles || []).includes("seller");
            const hasBuyerRole = (u.roles || []).includes("buyer");
            let buyerRole = "invalid";
            if (hasSellerRole && hasBuyerRole) {
                buyerRole = "both";
            } else if (hasSellerRole) {
                buyerRole = "seller_only";
            } else {
                buyerRole = "buyer_only"; // default if they registered for marketplace but no explicit seller role
            }

            return {
                id: u.id,
                name: u.fullName || u.name || "Unknown",
                email: u.email,
                phone: u.phone || "",
                roles: u.roles || [],
                buyerRole,
                status: u.status || "active",
                createdAt: u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : u.createdAt || null
            };
        });

        // Filter out any we marked invalid (should not happen with the logic above)
        const validUsers = marketplaceUsers.filter(u => u.buyerRole !== "invalid");
        validUsers.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        return NextResponse.json({ success: true, users: validUsers });

    } catch (error) {
        logger.error("Failed to fetch marketplace buyers:", error);
        return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
    }
}
