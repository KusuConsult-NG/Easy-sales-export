export const dynamic = 'force-dynamic';

/**
 * Admin API Route: Orphaned User Detection and Repair
 * 
 * GET /api/admin/orphaned-users - List all orphaned users
 * POST /api/admin/orphaned-users - Repair all orphaned users
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { isPlatformAdmin } from "@/lib/admin-permissions";
import { detectOrphanedUsers, repairAllOrphanedUsers, repairOrphanedUser } from '@/lib/orphaned-user-repair';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
    try {
        // Check admin authentication
        const session = (await requireSession()).session;

        if (!isPlatformAdmin(session?.user?.roles)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        // Say how much of Auth was actually looked at.
        //
        // `count` used to be the length of a scan of the first 1,000 Auth
        // accounts, presented as the number of orphaned users on the platform.
        // Against 41,105 accounts that is 2.4% of them, and "0" read as "none"
        // rather than as "none in the first thousand".
        //
        // `scanned` and `complete` are on the response so the screen can say
        // which it got; `nextPageToken` continues the walk.
        const pageToken = request.nextUrl.searchParams.get('pageToken') ?? undefined;
        const scan = await detectOrphanedUsers(pageToken);

        return NextResponse.json({
            count: scan.orphaned.length,
            users: scan.orphaned,
            scanned: scan.scanned,
            complete: scan.complete,
            nextPageToken: scan.nextPageToken,
        });
    } catch (error) {
        logger.error('Failed to detect orphaned users', error);
        return NextResponse.json(
            { error: 'Failed to detect orphaned users' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        // Check admin authentication
        const session = (await requireSession()).session;

        if (!isPlatformAdmin(session?.user?.roles)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const body = await request.json();

        // Repair specific user or all users
        if (body.uid) {
            // Repair single user
            const result = await repairOrphanedUser(body.uid);
            return NextResponse.json(result);
        } else {
            // Repair the orphans in one scan, and report whether that was all
            // of them. `complete: false` means there are more Auth accounts
            // than this call examined — repost with `pageToken` to continue.
            const results = await repairAllOrphanedUsers(body.pageToken);
            return NextResponse.json(results);
        }
    } catch (error) {
        logger.error('Failed to repair orphaned users', error);
        return NextResponse.json(
            { error: 'Failed to repair orphaned users' },
            { status: 500 }
        );
    }
}
