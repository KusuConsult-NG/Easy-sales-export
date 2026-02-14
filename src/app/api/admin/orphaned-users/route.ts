/**
 * Admin API Route: Orphaned User Detection and Repair
 * 
 * GET /api/admin/orphaned-users - List all orphaned users
 * POST /api/admin/orphaned-users - Repair all orphaned users
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { detectOrphanedUsers, repairAllOrphanedUsers, repairOrphanedUser } from '@/lib/orphaned-user-repair';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
    try {
        // Check admin authentication
        const session = await getServerSession(authOptions);

        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        // Detect orphaned users
        const orphanedUsers = await detectOrphanedUsers();

        return NextResponse.json({
            count: orphanedUsers.length,
            users: orphanedUsers,
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
        const session = await getServerSession(authOptions);

        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const body = await request.json();

        // Repair specific user or all users
        if (body.uid) {
            // Repair single user
            const result = await repairOrphanedUser(body.uid);
            return NextResponse.json(result);
        } else {
            // Repair all orphaned users
            const results = await repairAllOrphanedUsers();
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
