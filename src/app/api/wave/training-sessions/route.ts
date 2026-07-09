export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * GET /api/wave/training-sessions
 * Returns upcoming training sessions.
 *
 * Supports cursor-based pagination:
 *   ?cursor=<ISO timestamp of last item's scheduledAt>
 *   ?limit=<number, default 20, max 50>
 *
 * Response: { success, data: { sessions }, meta: { cursor, hasMore } }
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: { cursor: null, hasMore: false } },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const rawLimit = parseInt(searchParams.get("limit") || "20");
        const limit = Math.min(Math.max(rawLimit, 1), 50);
        const cursor = searchParams.get("cursor");

        const db = getAdminDb();

        let query: import("@/lib/supabase-db").SupabaseQuery = db
            .collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .orderBy("scheduledAt", "asc")
            .limit(limit + 1); // Fetch one extra to determine hasMore

        if (cursor) {
            const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                query = query.startAfter(cursorDate);
            }
        }

        const snap = await query.get();

        const hasMore = snap.docs.length > limit;
        const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;

        const sessions = docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            scheduledAt: doc.data().scheduledAt?.toDate?.()?.toISOString() ?? doc.data().scheduledAt,
            createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
        }));

        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().scheduledAt?.toDate?.()?.toISOString() ?? null
            : null;

        return NextResponse.json({
            success: true,
            data: { sessions },
            meta: { cursor: nextCursor, hasMore },
        });
    } catch (error) {
        logger.error("GET /api/wave/training-sessions error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to load training sessions", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}

/**
 * POST /api/wave/training-sessions
 * Create a new training session (admin only).
 *
 * Response: { success, data: { id }, meta: { cursor: null, hasMore: false } }
 */
export async function POST(req: Request) {
    try {
        const session = (await requireSession()).session;
        if (!session || !session.user) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized", meta: { cursor: null, hasMore: false } },
                { status: 401 }
            );
        }
        const isAdmin = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");
        if (!isAdmin) {
            return NextResponse.json(
                { success: false, data: null, error: "Unauthorized — admin access required", meta: { cursor: null, hasMore: false } },
                { status: 403 }
            );
        }

        const body = await req.json();
        const { title, description, scheduledAt, durationMinutes, roomName } = body;

        if (!title || !scheduledAt || !durationMinutes) {
            return NextResponse.json(
                { success: false, data: null, error: "title, scheduledAt, and durationMinutes are required", meta: { cursor: null, hasMore: false } },
                { status: 400 }
            );
        }

        const db = getAdminDb();
        const ref = await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).add({
            title,
            description: description || "",
            scheduledAt: new Date(scheduledAt),
            durationMinutes: Number(durationMinutes),
            roomName: roomName || `wave-training-${Date.now()}`,
            isActive: true,
            createdAt: new Date(),
            createdBy: session.user.id,
        });

        return NextResponse.json({
            success: true,
            data: { id: ref.id },
            meta: { cursor: null, hasMore: false },
        });
    } catch (error) {
        logger.error("POST /api/wave/training-sessions error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to create session", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}
