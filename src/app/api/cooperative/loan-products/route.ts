export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";

/**
 * API Route: Get All Loan Products
 * Public endpoint - no auth required to view products
 */
export async function GET(request: NextRequest) {
    try {
        const snapshot = await db.collection("loan_products")
            .orderBy("minAmount", "asc")
            .get();

        const products = snapshot.docs.map(doc => ({
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
