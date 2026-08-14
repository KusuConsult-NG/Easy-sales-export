export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
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

        // Asked of the database, not of the whole users table.
        //
        // This did `db.collection(USERS).get()` and filtered in memory. The
        // adapter caps an unbounded query at SUPABASE_DEFAULT_QUERY_LIMIT —
        // 5,000 — and sets `snapshot.truncated` so a partial answer is not
        // silent. This route did not look at it.
        //
        // The users table holds tens of thousands of rows. So an admin opening
        // the marketplace buyers screen saw the marketplace users found among
        // the first five thousand USERS, presented as the complete list. A
        // buyer who registered later was simply absent, and the screen said
        // nothing.
        //
        // array-contains-any asks Postgres for the rows that match, so the
        // limit now applies to marketplace users rather than to users in
        // general — a much smaller set — and the truncation flag is reported
        // either way.
        //
        // THE THIRD CONDITION WAS DEAD
        // The filter also had:
        //
        //     const isRegisteredInMarketplace = u.serviceRegistrations?.marketplace === true;
        //
        // serviceRegistrations.marketplace is always an OBJECT —
        // { status, accountType, paymentStatus, ... } — written by
        // approve-seller and admin.ts. An object is never === true, so that
        // clause never fired. It is dropped rather than repaired: a user with a
        // marketplace registration and no seller or buyer role is not something
        // the approval path produces, and inventing a query for a case that has
        // never existed would be guessing.
        const snapshot = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains-any", ["seller", "buyer"])
            .get();

        const truncated = Boolean((snapshot as any).truncated);
        if (truncated) {
            logger.warn("[admin/marketplace/buyers] result truncated by the adapter's query limit");
        }

        const users = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

        const marketplaceUsers = users.map((u: any) => {
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

        // Reported, never silent. A screen showing a partial list as though it
        // were whole is how an admin concludes a member does not exist.
        return NextResponse.json({ success: true, users: validUsers, truncated });

    } catch (error) {
        logger.error("Failed to fetch marketplace buyers:", error);
        return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
    }
}
