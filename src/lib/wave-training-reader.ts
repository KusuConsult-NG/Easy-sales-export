import "server-only";

import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { canReadWaveProgramme } from "@/lib/wave-access";
import { logger } from "@/lib/logger";

/**
 * The WAVE training schedule, and who may see it — decided once.
 *
 *   #567 /wave/live-training ASKED THIS APPLICATION FOR THIS OVER HTTP, on a
 *        60-SECOND POLL.
 *
 *   A "use client" page whose first act on mount was a `fetch` back to the
 *   server that had just rendered it. Same shape as #562, #564 — with the
 *   difference that this one repeats, so the wasted first hop happened on every
 *   visit and the poll went on after it.
 *
 * ── THIS FUNCTION DECIDES ACCESS, AND THAT IS WHY IT IS ONE FUNCTION ────────
 *
 *   The listing carries `roomKey` — the server-minted secret that actually
 *   opens the video classroom — and `customMeetingLink`. Those are the reason
 *   the endpoint is gated at all, and the gate has been wrong twice:
 *
 *     BEING SIGNED IN IS NOT BEING IN THE PROGRAMME. It asked for a session and
 *     nothing else, then returned every training document including the meeting
 *     links. So the live rooms for a women's-only programme were reachable by
 *     every account on the platform.
 *
 *     THE SESSION'S COPY OF THE STATUS GOES STALE. It read
 *     serviceRegistrations.wave.status off the SESSION alone, which is minted
 *     at login and refreshed hourly. The /wave/(member) layout has a database
 *     fallback for exactly this; this route had none, so a member approved five
 *     minutes ago was inside the member area looking at a screen that told her
 *     she had no access to it, for up to an hour.
 *
 *   A server page that copied the query and left the gate behind would be the
 *   first defect again, and one that copied the gate would be a second place
 *   for the staleness rule to be got wrong. So the gate and the listing stay
 *   together, and the route calls this too.
 *
 *   The RULE is unchanged — canReadWaveProgramme, deliberately generous, admits
 *   someone still mid-application — and the database fallback still runs only
 *   when the session's own copy does not already grant access, so the ordinary
 *   request still costs no extra query.
 */

export type WaveTrainingSession = {
    id: string;
    title: string;
    description: string;
    durationMinutes: number | null;
    roomName: string | null;
    roomKey: string | null;
    customMeetingLink: string | null;
    isActive: boolean;
    scheduledAt: string | null;
    createdAt: string | null;
};

export type WaveTrainingResult =
    | { allowed: false }
    | { allowed: true; sessions: WaveTrainingSession[]; cursor: string | null; hasMore: boolean };

/** The session shape this reader needs — whatever requireSession/auth returns. */
type CallerSession = { user: { id: string; roles?: string[]; [k: string]: any } };

/**
 * Whether this caller may read the WAVE programme, checking the database only
 * when the session's own copy of the status does not already say yes.
 */
export async function callerMayReadWaveProgramme(session: CallerSession): Promise<boolean> {
    let waveRegStatus = (session.user as any)?.serviceRegistrations?.wave?.status ?? null;
    let allowed = canReadWaveProgramme({ roles: session.user.roles, waveRegStatus });

    if (allowed) return true;

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

    return allowed;
}

export async function readWaveTrainingSessions(
    session: CallerSession,
    options: { limit?: number; cursor?: string | null } = {},
): Promise<WaveTrainingResult> {
    if (!(await callerMayReadWaveProgramme(session))) return { allowed: false };

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const cursor = options.cursor ?? null;

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
    const sessions: WaveTrainingSession[] = docs.map((doc: any) => {
        const data = doc.data() ?? {};
        return {
            id: doc.id,
            title: data.title ?? "",
            description: data.description ?? "",
            durationMinutes: data.durationMinutes ?? null,
            roomName: data.roomName ?? null,
            //   #188 — the built-in classroom. `roomName` is derived from the
            //   event id and is only the row's correlation key; `roomKey` is
            //   the server-minted secret that actually opens the room. Every
            //   caller of this function is behind the gate above.
            roomKey: data.roomKey ?? null,
            customMeetingLink: data.customMeetingLink ?? null,
            isActive: data.isActive ?? false,
            scheduledAt: data.scheduledAt?.toDate?.()?.toISOString() ?? data.scheduledAt ?? null,
            createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        };
    });

    const nextCursor = hasMore && docs.length > 0
        ? docs[docs.length - 1].data().scheduledAt?.toDate?.()?.toISOString() ?? null
        : null;

    return { allowed: true, sessions, cursor: nextCursor, hasMore };
}
