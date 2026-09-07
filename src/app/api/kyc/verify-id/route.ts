export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

/**
 * Automated ID verification has been removed (#485).
 * Uploaded ID documents are reviewed manually by the admin team within 24-48 hours.
 */
export async function POST() {
    return NextResponse.json(
        { error: 'Live ID verification is no longer available. Your document will be reviewed by our team.' },
        { status: 410 }
    );
}
