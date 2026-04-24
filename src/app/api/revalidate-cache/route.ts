import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * Cache Revalidation Route
 *
 * GET /api/revalidate-cache?path=/some/path
 *
 * Requires a valid REVALIDATE_SECRET token in:
 *   - Header: Authorization: Bearer <token>
 *   - OR query param: ?token=<token>  (fallback for simple integrations)
 *
 * This prevents unauthenticated ISR cache busting attacks.
 */
export async function GET(request: NextRequest) {
    const secret = process.env.REVALIDATE_SECRET;

    if (!secret) {
        logger.error('[Revalidate] REVALIDATE_SECRET env var is not configured.');
        return NextResponse.json({ revalidated: false, message: 'Server misconfiguration' }, { status: 500 });
    }

    // Accept token from Authorization header or query param
    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const queryToken = request.nextUrl.searchParams.get('token');
    const providedToken = bearerToken ?? queryToken;

    if (!providedToken || providedToken !== secret) {
        logger.warn('[Revalidate] Unauthorized cache revalidation attempt rejected.');
        return NextResponse.json({ revalidated: false, message: 'Unauthorized' }, { status: 401 });
    }

    const path = request.nextUrl.searchParams.get('path') || '/admin/academy';

    try {
        revalidatePath(path);
        revalidatePath('/academy');
        revalidatePath('/dashboard/academy');
        logger.info(`[Revalidate] Cache revalidated for path: ${path}`);
        return NextResponse.json({ revalidated: true, now: Date.now(), path });
    } catch (err) {
        logger.error('[Revalidate] Error revalidating cache:', err);
        return NextResponse.json({ revalidated: false, message: 'Error revalidating' }, { status: 500 });
    }
}
