import { NextResponse } from 'next/server';

/**
 * NIN verification via QoreID has been removed.
 * NIN is now collected as part of the identity document upload and reviewed manually.
 */
export async function POST() {
    return NextResponse.json(
        { error: 'NIN live verification is no longer available. Your ID will be reviewed by our team.' },
        { status: 410 }
    );
}
