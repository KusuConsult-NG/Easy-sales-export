export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { readWaveTrainingSessions } from "@/lib/wave-training-reader";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { mintClassroomRoomKey } from "@/lib/classroom-room-key";

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

        //   #567 The gate and the listing moved TOGETHER to
        //   lib/wave-training-reader, so /wave/live-training can read them on
        //   the server rather than fetching this route from the browser on a
        //   60-second poll. They moved together deliberately: this listing
        //   carries roomKey — the secret that opens the video classroom — and
        //   the gate in front of it has been wrong twice. Copying one without
        //   the other is how it goes wrong a third time.
        const { searchParams } = new URL(request.url);
        const rawLimit = parseInt(searchParams.get("limit") || "20");

        const result = await readWaveTrainingSessions(session as any, {
            limit: rawLimit,
            cursor: searchParams.get("cursor"),
        });

        if (!result.allowed) {
            return NextResponse.json(
                { success: false, data: null, error: "WAVE programme access required", meta: { cursor: null, hasMore: false } },
                { status: 403 }
            );
        }

        return NextResponse.json({
            success: true,
            data: { sessions: result.sessions },
            meta: { cursor: result.cursor, hasMore: result.hasMore },
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
        // #265 wave_admin holds wave:manage_training — the permission that
        // names this exact operation — and a hand-written pair refused it.
        const isAdmin = hasAdminPermission(session.user.roles, "wave:manage_training");
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
            // #188. A session scheduled through this route needs a classroom
            // too, and it must be minted here rather than derived: the row
            // above is the correlation key, this is the credential.
            roomKey: mintClassroomRoomKey(),
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
