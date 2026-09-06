export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { isRetired } from "@/lib/record-retirement";

/**
 * API Route: Get All Loan Products (Admin Only)
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
        // #438: was isAdmin(...) — true for ANY of the ten admin roles.
        //
        // "cooperatives:approve_loans" and NOT "cooperatives:manage_products",
        // for the reason actions/loan-products.ts already gives: the matrix
        // withholds manage_products from the plain `admin` role, so adopting it
        // would take away something an admin can do today. My first pass used
        // manage_products and two existing ratchets caught it — the lockout
        // check by name, and the one asserting nothing asks for that permission.
        if (!hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Get all loan products (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.LOAN_PRODUCTS)
            .orderBy("minAmount", "asc")
            .get();

        // #302 Retired products leave this list too — it is the second of two
        // that read this collection, and fixing one of a pair is the mistake
        // this audit keeps finding.
        const products = snapshot.docs
            .filter(doc => !isRetired(doc.data()))
            .map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

        return NextResponse.json({
            success: true,
            products
        });
    } catch (error) {
        logger.error("Failed to fetch loan products:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
