export const dynamic = "force-dynamic";

/**
 * GET /api/locations/polling-units?state=&lga=&ward=
 *
 *   #792 The polling units for ONE ward. See lib/polling-units for why this is
 *   a request rather than a module the form imports: the register is about five
 *   megabytes and a form needs one ward's worth.
 *
 * ── IT IS GATED, AND MY FIRST VERSION WAS NOT ───────────────────────────────
 *
 *   The first version of this route was deliberately public, and the argument
 *   was not silly: INEC publishes the polling-unit register for the whole
 *   country and prints it on every voter's card, so it is reference data like
 *   the state and LGA lists already compiled into the pages that use it. The
 *   unit ratchet was told so, in as many words, on its public-by-design list.
 *
 *   THE END-TO-END AUTH CONTRACT CAUGHT IT ANYWAY. api-auth-contract discovers
 *   every route under src/app/api and requires each one to refuse an anonymous
 *   caller unless it is listed public THERE too — a second, independent guard
 *   that I did not know about and had not satisfied.
 *
 *   Told twice by the platform's own rules, the right move was to re-examine
 *   the decision rather than add a second exemption. And it does not survive:
 *   THE ONLY CALLER IS THE WAVE APPLICATION FORM, WHICH IS BEHIND A LOGIN. A
 *   member filling it in is signed in, so a session check costs her nothing —
 *   while public access buys nobody anything and leaves 172,000 records free to
 *   enumerate on the owner's hosting.
 *
 *   "Published elsewhere" is a reason it would not be a LEAK. It is not a
 *   reason to serve it to callers who have no use for it.
 *
 *   Still bounded: one ward per request, and a request naming a ward that is
 *   not in the register gets an empty list rather than an error, because "there
 *   is no list for this ward" is the ordinary answer for 93 of them.
 */

import { NextRequest, NextResponse } from "next/server";
import { pollingUnitsFor } from "@/lib/polling-units";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized" },
                { status: 401 },
            );
        }

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
