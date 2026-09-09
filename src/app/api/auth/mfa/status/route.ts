export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { readMfaStatus } from "@/lib/mfa-status-reader";
import { withRateLimit } from "@/lib/rate-limit";

/**
 * Check MFA status for current user
 */
async function getMFAStatusHandler(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        //   #567 The read moved to lib/mfa-status-reader so
        //   /settings/security/mfa can read it on the SERVER rather than
        //   fetching this route from the browser after the page had already
        //   been rendered. It THROWS rather than answering false when it
        //   cannot read, which is what keeps the catch below meaningful: a
        //   failure has never again been reportable as "unprotected".
        const { enabled } = await readMfaStatus(session.user.id);

        return NextResponse.json({
            success: true,
            enabled,
            authenticated: true,
        });
    } catch (error: any) {
        // Was: { success: true, enabled: false, error: "Failed to check status" }.
        //
        // A database failure reported a DEFINITIVE "this account has no second
        // factor" — success:true and enabled:false — when what happened was
        // that the account's MFA state could not be read at all. #245's shape
        // (a kill switch that failed OPEN on a database error), on the
        // indicator that tells a member whether their account is protected.
        //
        // It also defeated the one caller that was doing the right thing:
        // /profile checks `mfaData.success` before believing the answer, and
        // success:true made that check worthless.
        //
        // Not knowing is not the same as off, so it is no longer reported as
        // off. The status code matches, so a caller reading response.ok gets
        // the same answer as one reading the body.
        logger.error("MFA status check error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to check status" },
            { status: 500 },
        );
    }
}

export const GET = withRateLimit(getMFAStatusHandler);
