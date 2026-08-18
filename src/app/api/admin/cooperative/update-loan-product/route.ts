export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { recordAdminAction } from "@/lib/audit-log";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { hasAdminPermission } from "@/lib/admin-permissions";

/**
 * API Route: Update Loan Product (Admin Only)
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check if user is admin
        if (!hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { productId, name, description, minAmount, maxAmount, interestRate, durationMonths, isActive } = body;

        if (!productId) {
            return NextResponse.json(
                { success: false, message: "Product ID is required" },
                { status: 400 }
            );
        }

        // Validate inputs
        if (!name || !description || !minAmount || !maxAmount || !interestRate || !durationMonths) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        if (minAmount >= maxAmount) {
            return NextResponse.json(
                { success: false, message: "Minimum amount must be less than maximum amount" },
                { status: 400 }
            );
        }

        // Get product (Admin SDK)
        const productRef = db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Product not found" },
                { status: 404 }
            );
        }

        // Update product
        await productRef.update({
            name,
            description,
            minAmount: Number(minAmount),
            maxAmount: Number(maxAmount),
            interestRate: Number(interestRate),
            durationMonths: Number(durationMonths),
            isActive: Boolean(isActive),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: session.user.id,
        });

        // The interest rate every future borrower on this product will pay.
        // create and delete are recorded; leaving update out would mean the log
        // shows a product created at one rate and deleted at another with no
        // trace of the change between.
        await recordAdminAction({
            action: "loan_product_updated",
            userId: session.user.id,
            targetId: productId,
            targetType: "loan_product",
            metadata: {
                before: productDoc.data() ?? null,
                after: { name, minAmount: Number(minAmount), maxAmount: Number(maxAmount), interestRate: Number(interestRate), durationMonths: Number(durationMonths), isActive: Boolean(isActive) },
            },
        });

        return NextResponse.json({
            success: true,
            message: "Loan product updated successfully"
        });
    } catch (error) {
        logger.error("Failed to update loan product:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
