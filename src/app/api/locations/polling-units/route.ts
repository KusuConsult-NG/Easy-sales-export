export const dynamic = "force-dynamic";

/**
 * GET /api/locations/polling-units?state=&lga=&ward=
 *
 *   #792 The polling units for ONE ward. See lib/polling-units for why this is
 *   a request rather than a module the form imports: the register is about five
 *   megabytes and a form needs one ward's worth.
 *
 * ── WHY THIS IS NOT GATED ───────────────────────────────────────────────────
 *
 *   Deliberately, and worth stating because #567's header is the opposite case.
 *   The WAVE training listing is gated because it carries `roomKey`, the secret
 *   that opens a live classroom. THIS carries the names of polling units, which
 *   INEC publishes for the whole country and prints on every voter's card. It
 *   is reference data, like the state and LGA lists already compiled into the
 *   pages that use it.
 *
 *   It is still bounded: one ward per request, and a request naming a ward that
 *   is not in the register gets an empty list rather than an error, because
 *   "there is no list for this ward" is the ordinary answer for 93 of them.
 */

import { NextRequest, NextResponse } from "next/server";
import { pollingUnitsFor } from "@/lib/polling-units";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const state = searchParams.get("state") ?? "";
        const lga = searchParams.get("lga") ?? "";
        const ward = searchParams.get("ward") ?? "";

        const units = await pollingUnitsFor(state, lga, ward);

        return NextResponse.json({
            success: true,
            data: { pollingUnits: units },
            error: null,
        });
    } catch (error) {
        logger.error("GET /api/locations/polling-units error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to load polling units" },
            { status: 500 },
        );
    }
}
