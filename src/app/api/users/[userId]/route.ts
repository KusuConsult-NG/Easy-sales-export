import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { toMillis } from "@/lib/firestore-serialize";

// Force dynamic execution - don't try to statically generate this route
export const dynamic = 'force-dynamic';

/**
 * GET /api/users/[userId]
 * Fetch user profile data
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { userId } = await params;
        // Verify authentication
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }



        // Users can only access their own profile (unless admin)
        if (session.user.id !== userId && !session.user.roles?.includes('admin') && !session.user.roles?.includes('super_admin')) {
            return NextResponse.json(
                { error: 'Forbidden' },
                { status: 403 }
            );
        }

        // Fetch user from Firestore
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

        if (!userDoc.exists) {
            return NextResponse.json(
                { error: 'User not found' },
                { status: 404 }
            );
        }

        const userData = userDoc.data();

        return NextResponse.json({
            id: userDoc.id,
            name: userData?.name || '',
            email: userData?.email || '',
            role: userData?.role || 'member',
            // toMillis, not `?.toMillis?.() || Date.now()`.
            //
            // The JSONB writer stores a `new Date()` as an ISO string, for which
            // `toMillis` is undefined — so this reported the CURRENT moment as
            // the account's creation date for every user whose createdAt was
            // written that way. Date.now() stays as the last resort for a value
            // that genuinely cannot be read.
            createdAt: toMillis(userData?.createdAt) || Date.now(),
            phone: userData?.phone || '',
            location: userData?.location || '',
        });
    } catch (error) {
        logger.error('Error fetching user:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
