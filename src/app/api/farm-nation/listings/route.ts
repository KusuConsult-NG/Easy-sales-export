export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { readPublicLandListings } from "@/lib/land-listings-reader";

/**
 * API Route: Get All Land Listings
 * Returns verified listings for public viewing
 *
 *   #562 The body of this handler moved to lib/land-listings-reader, so that
 *   /land and /farm-nation/map can read the same thing on the SERVER instead of
 *   fetching this route from the browser after they have already been rendered.
 *
 *   The two decisions this endpoint carries — which statuses are public, and
 *   which fields a stranger may not see — were each a defect once, and they now
 *   live in one place with three callers rather than being copied per caller.
 *   The route itself is unchanged from outside: same URL, same shape, same
 *   absence of authentication.
 */
export async function GET(request: NextRequest) {
    try {
        const listings = await readPublicLandListings();

        return NextResponse.json({
            success: true,
            data: { listings },
            meta: null
        });
    } catch (error) {
        logger.error("Failed to fetch listings:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Internal server error", meta: null },
            { status: 500 }
        );
    }
}
