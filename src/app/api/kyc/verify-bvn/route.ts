export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

/**
 * BVN verification via QoreID has been removed.
 * BVN is now collected as plain text and reviewed manually by the admin team.
 */
export async function POST() {
    return NextResponse.json(
        { error: 'BVN live verification is no longer available. Your BVN will be reviewed by our team.' },
        { status: 410 }
    );
}
