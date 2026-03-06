export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

/**
 * BVN live verification is currently disabled.
 * BVN is collected as plain text and reviewed manually by the admin team.
 * Will be re-enabled once BVN-premium is activated on the QoreID account.
 */
export async function POST() {
    return NextResponse.json(
        { error: 'BVN live verification is not available yet. Your BVN will be reviewed by our team.' },
        { status: 410 }
    );
}
