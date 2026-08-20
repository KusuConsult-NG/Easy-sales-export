export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { canReadWaveProgramme } from "@/lib/wave-access";
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

        // Being signed in is not being in the programme.
        //
        // This asked for a session and nothing else, then returned every
        // training session document — including customMeetingLink and roomName,
        // which are the live video room. So the meeting links for a
        // women's-only programme were available to every account on the
        // platform, including the ones /api/wave/check-eligibility exists to
        // turn away.
        //
        // src/middleware.ts has enforced exactly this for /wave PAGES since it
        // was written. The rule now lives in @/lib/wave-access and both read it.
        /**
         * Two layers, because the session value goes stale.
         *
         * THE DEFECT
         * ----------
         * This read `serviceRegistrations.wave.status` off the SESSION alone. That
         * value is minted at login and refreshed hourly — which is the entire
         * reason module-access-check.ts exists and carries a database fallback for
         * it, in its own words: "the user's JWT is still stale and doesn't carry the
         * new role, so hasAppAccess returns false and the layout bounces them back".
         *
         * The /wave/(member) layout uses that fallback, so a member approved five
         * minutes ago is admitted to the member area. This route had no fallback, so
         * her training list answered 403 for up to an hour. She was inside the
         * programme looking at a screen that told her she had no access to it.
         *
         * The RULE is unchanged — canReadWaveProgramme, which is deliberately
         * generous and admits someone still mid-application. Only where the status
         * is read from changes, and only when the session's copy does not already
         * grant access, so the ordinary request still costs no query.
         */
        let waveRegStatus = (session.user as any)?.serviceRegistrations?.wave?.status ?? null;
        let allowed = canReadWaveProgramme({ roles: session.user.roles, waveRegStatus });

        if (!allowed) {
            try {
                const freshDoc = await getAdminDb()
                    .collection(COLLECTIONS.USERS)
                    .doc(session.user.id)
                    .get();
                const fresh = freshDoc.data();
                if (fresh) {
                    waveRegStatus = fresh.serviceRegistrations?.wave?.status ?? null;
                    allowed = canReadWaveProgramme({
                        // The stored roles too: an admin whose role was granted after
                        // login is in the same position.
                        roles: Array.isArray(fresh.roles) ? fresh.roles : session.user.roles,
                        waveRegStatus,
                    });
                }
            } catch (e) {
                // The session's answer stands, which is the refusal. Logged rather
                // than swallowed: a failing fallback looks exactly like a legitimate
                // 403 from the caller's side.
                logger.error("[WAVE training-sessions] Access fallback lookup failed", e);
            }
        }

        if (!allowed) {
            return NextResponse.json(
                { success: false, data: null, error: "WAVE programme access required", meta: { cursor: null, hasMore: false } },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const rawLimit = parseInt(searchParams.get("limit") || "20");
        const limit = Math.min(Math.max(rawLimit, 1), 50);
        const cursor = searchParams.get("cursor");

        const db = getAdminDb();

        // Deactivated sessions are not listed.
        //
        // endWaveLiveSession sets isActive: false (wave/_admin.ts) and nothing
        // read it, so a session an admin had ended stayed in this response with
        // its room name and meeting link intact.
        let query: import("@/lib/supabase-db").SupabaseQuery = db
            .collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .where("isActive", "==", true)
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

        // Named fields, not the document.
        //
        // The spread also carried createdBy — the user id of the admin who
        // scheduled the session — which no participant needs.
        const sessions = docs.map((doc: any) => {
            const data = doc.data() ?? {};
            return {
                id: doc.id,
                title: data.title ?? "",
                description: data.description ?? "",
                durationMinutes: data.durationMinutes ?? null,
                roomName: data.roomName ?? null,
                customMeetingLink: data.customMeetingLink ?? null,
                isActive: data.isActive ?? false,
                scheduledAt: data.scheduledAt?.toDate?.()?.toISOString() ?? data.scheduledAt,
                createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
            };
        });

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
