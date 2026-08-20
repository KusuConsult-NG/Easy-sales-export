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
 * API Route: Create Loan Product (Admin Only)
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
        const { name, description, minAmount, maxAmount, interestRate, durationMonths, isActive } = body;

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

        // Create loan product (Admin SDK)
        const productRef = db.collection(COLLECTIONS.LOAN_PRODUCTS).doc();
        await productRef.set({
            name,
            description,
            minAmount: Number(minAmount),
            maxAmount: Number(maxAmount),
            interestRate: Number(interestRate),
            durationMonths: Number(durationMonths),
            isActive: Boolean(isActive),
            createdAt: FieldValue.serverTimestamp(),
            createdBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // A loan product sets the interest every borrower pays. Who changed
        // it, and to what, is exactly what an audit log is for — and
        // 'loan_product_created' has been in the action vocabulary all along
        // with nothing writing it.
        await recordAdminAction({
            action: "loan_product_created",
            userId: session.user.id,
            targetId: productRef.id,
            targetType: "loan_product",
            metadata: { name, minAmount: Number(minAmount), maxAmount: Number(maxAmount), interestRate: Number(interestRate), durationMonths: Number(durationMonths), isActive: Boolean(isActive) },
        });

        return NextResponse.json({
            success: true,
            message: "Loan product created successfully",
            productId: productRef.id
        });
    } catch (error) {
        logger.error("Failed to create loan product:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
