export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { stripPii } from "@/lib/admin-pii";

/**
 * API Route: Get All Seller Verifications (Admin Only)
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check if user is admin
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        /**
         *   #339 THE SECOND DOOR ONTO THE SELLER KYC PACK.
         *
         *        #154 gated the server action over this collection — the raw
         *        application is spread into the response, and
         *        api/marketplace/submit-verification writes into it:
         *
         *            documents:   { businessDoc, idDoc, addressProof }
         *            bankDetails: { bankName, accountNumber, accountName }
         *            bankAccount: { bankName, accountNumber, accountName }
         *
         *        — scanned identity papers and a bank account number. That fix
         *        used lib/admin-pii's stripPii over "marketplace:approve_sellers".
         *        This route spreads `...data` from the same collection and was
         *        still on isAdmin(), true for all TEN admin roles.
         *
         *        Same resolution, for the same reason the action gave: a support
         *        agent answering "did my verification go through" needs the
         *        STATUS, so the list stays open and the identity and money keys
         *        come out. Only super_admin, admin and marketplace_admin — who
         *        can actually approve one — see the pack.
         */
        const maySeeVerificationPii = hasAdminPermission(session.user.roles, "marketplace:approve_sellers");

        // Get all seller verifications (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .orderBy("createdAt", "desc")
            .get();

        // Truncation is reported, not swallowed.
        //
        // The adapter caps an unbounded query at SUPABASE_DEFAULT_QUERY_LIMIT
        // and sets `truncated` for exactly this reason — analytics.service.ts
        // and cron/reconcile-fulfilment both read it. An admin queue that shows
        // the first N as though they were all of them is how a pending item is
        // never actioned.
        const truncated = Boolean((snapshot as any).truncated);
        if (truncated) {
            logger.warn("[admin/marketplace/seller-verifications] result truncated by the adapter's query limit");
        }

        const verifications = await Promise.all(
            snapshot.docs.map(async (verDoc) => {
                const data = verDoc.data();

                // Get user details
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(data.userId).get();
                const userData = userDoc.exists ? userDoc.data() : {};

                return {
                    id: verDoc.id,
                    ...(maySeeVerificationPii ? data : stripPii(data)),
                    // Defensive name chain: structured fields → legacy fullName → name → email
                    userName: (userData?.firstName || userData?.lastName)
                        ? [userData?.firstName, userData?.otherName, userData?.lastName].filter(Boolean).join(" ")
                        : (userData?.fullName || userData?.name || userData?.email || "Unknown User"),
                    userEmail: userData?.email || "",
                    createdAt: data.createdAt?.toDate?.() || new Date(),
                };
            })
        );

        return NextResponse.json({
            truncated,
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
