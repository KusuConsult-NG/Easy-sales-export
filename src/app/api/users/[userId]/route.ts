import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/firebase-admin';

/**
 * GET /api/users/[userId]
 * Fetch user profile data
 */
export async function GET(
    request: NextRequest,
    { params }: { params: { userId: string } }
) {
    try {
        // Verify authentication
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const userId = params.userId;

        // Users can only access their own profile (unless admin)
        if (session.user.id !== userId && session.user.role !== 'admin' && session.user.role !== 'super_admin') {
            return NextResponse.json(
                { error: 'Forbidden' },
                { status: 403 }
            );
        }

        // Fetch user from Firestore
        const userDoc = await db.collection('users').doc(userId).get();

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
            createdAt: userData?.createdAt?.toMillis?.() || Date.now(),
            phone: userData?.phone || '',
            location: userData?.location || '',
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
