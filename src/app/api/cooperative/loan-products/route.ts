export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { readActiveLoanProducts } from "@/lib/cooperative-readers";

/**
 * API Route: Get All Loan Products
 * Public endpoint - no auth required to view products
 */
/**
 * The fields a prospective borrower is shown.
 *
 * The route returned `{ id, ...doc.data() }`, which included `createdBy` — the
 * user id of the admin who created the product — on an endpoint with no
 * authentication. Same shape as the export catalogue and the land listings.
 */
/**
 * API Route: the loan products on offer.
 *
 *   #570 The body moved to lib/cooperative-readers so /cooperatives/loans can
 *   read it on the SERVER instead of fetching this route from the browser after
 *   the page had already been rendered. The finding it carries — an admin
 *   deactivating a product removed it from nowhere, because nothing read
 *   isActive — moved with it, along with the field whitelist.
 */
export async function GET(request: NextRequest) {
    try {
        const products = await readActiveLoanProducts();

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
