import "server-only";

import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { canReadWaveProgramme } from "@/lib/wave-access";
//   #787 The running session is selected with the same rule the member screen
//   applies, rather than a second copy of it — see findRunningSession.
import { findOpenSession, type LiveSessionWindow } from "@/lib/live-session-window";
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
    /**
     *   #778 When an administrator pressed Start.
     *
     *   OPTIONAL, AND THE OPTIONALITY IS LOAD-BEARING. The member page opens
     *   the room from this stamp rather than from the schedule, and a row
     *   written before the stamp existed has none — including any session in
     *   progress right now. So the key is OMITTED for such a row rather than
     *   set to null, because live-session-window distinguishes the two:
     *   absent means "legacy, fall back to the clock", null means "carries the
     *   field and has not been started".
     */
    startedAt?: string;
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

    const sessions: WaveTrainingSession[] = docs.map(projectSession);

    const nextCursor = hasMore && docs.length > 0
        ? docs[docs.length - 1].data().scheduledAt?.toDate?.()?.toISOString() ?? null
        : null;

    /*
     *   #787 AND THE SESSION THAT IS ACTUALLY RUNNING, WHICH THE PAGE ABOVE
     *        COULD NOT REACH.
     *
     *   The query is `isActive == true`, ORDERED OLDEST FIRST, capped at twenty,
     *   and the member screen asks for one page and never follows the cursor. So
     *   the twenty rows it receives are the twenty OLDEST sessions that have not
     *   been ended — and nothing ends them except an administrator remembering to
     *   press End, which closing the browser tab does not do.
     *
     *   Measured: twenty stale rows and one session started a minute ago, and
     *   the member's screen shows "No live session is running right now" while
     *   the host sits in the room. That is the owner's report — "Live Training
     *   is not connecting and does not allow end users to join" — and it gets
     *   worse every week the platform runs, because the list of never-ended
     *   sessions only grows.
     *
     *   So the running session is found separately and put at the front, and it
     *   is found NEWEST-FIRST because startWaveLiveSessionAction stamps
     *   `scheduledAt: new Date()` at the moment of starting. The page itself
     *   keeps its ascending order, which is the order the schedule is read in.
     */
    const running = await findRunningSession(db, new Set(sessions.map(s => s.id)));
    if (running) sessions.unshift(running);

    return { allowed: true, sessions, cursor: nextCursor, hasMore };
}

/**
 * How far back the running-session lookup reads.
 *
 * A running session is among the most recently scheduled by construction, so
 * this is slack rather than a real bound. It is stated and capped anyway: an
 * unbounded read of this collection is the defect on the other side of the one
 * above.
 */
const RUNNING_SESSION_SCAN = 200;

/**
 * The session open right now, if it is not already on the caller's page.
 *
 * THE SERVER DECIDES INCLUSION; THE CLIENT DECIDES DISPLAY. LiveTrainingClient
 * runs findOpenSession itself against the viewer's own clock — deliberately, see
 * its header — so an extra row here costs nothing and a missing one cannot be
 * recovered. That asymmetry is why the window below is widened by ten minutes
 * either side: a viewer whose clock is a few minutes off must still RECEIVE the
 * row, and it is their clock, not this one, that decides whether they are shown
 * the classroom.
 */
async function findRunningSession(
    db: ReturnType<typeof getAdminDb>,
    alreadyOnPage: ReadonlySet<string>,
): Promise<WaveTrainingSession | null> {
    const snap = await db
        .collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
        .where("isActive", "==", true)
        .orderBy("scheduledAt", "desc")
        .limit(RUNNING_SESSION_SCAN)
        .get();

    const rows = snap.docs.map(projectSession).filter(r => !alreadyOnPage.has(r.id));
    if (rows.length === 0) return null;

    const GRACE_MS = 10 * 60_000;
    const now = Date.now();
    for (const at of [now, now - GRACE_MS, now + GRACE_MS]) {
        const open = findOpenSession(rows as unknown as LiveSessionWindow[], at);
        if (open) return open as unknown as WaveTrainingSession;
    }
    return null;
}

/**
 * One row, projected field by field.
 *
 * NAMED FIELDS, NOT THE DOCUMENT — the spread this replaced also carried
 * `createdBy`, the user id of the admin who scheduled the session, which no
 * participant needs.
 *
 *   #787 ONE PROJECTOR, because there are two callers now. A second copy is how
 *   the running session would come back missing `roomKey` while the page's rows
 *   carried it — the #349/#773 shape, where a correct rule elsewhere is inert
 *   because something in between drops the key.
 */
function projectSession(doc: any): WaveTrainingSession {
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
            /*
             *   #778 SPREAD CONDITIONALLY, not `?? null`.
             *
             *   This projection is what the member page actually receives, and
             *   a field missing from it is a field the page can never see — the
             *   #773/#349 class, where a correct rule three files away is inert
             *   because something in between drops the key. Adding it as
             *   `startedAt: ... ?? null` would have been the opposite mistake:
             *   every legacy row would then CARRY the field as null, and
             *   live-session-window would read that as "not started" and close
             *   a session that is running right now.
             */
            ...(data.startedAt !== undefined && data.startedAt !== null
                ? { startedAt: data.startedAt?.toDate?.()?.toISOString() ?? String(data.startedAt) }
                : {}),
            createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    };
}
