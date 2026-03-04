export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * API Route: Create Loan Product (Admin Only)
 */
export async function POST(request: NextRequest) {
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
        const productRef = db.collection("loan_products").doc();
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
