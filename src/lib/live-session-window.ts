/**
 * When a scheduled live session is actually open to the people attending it.
 *
 *   #778 THE ROOM OPENED ON THE CLOCK, SO THE MEMBERS GOT THERE FIRST AND ONE
 *        OF THEM BECAME THE HOST.
 *
 *   Reported by the owner: "the admin starts an event and its asked to join
 *   while users are asked to join so the entire event is not being hosted by
 *   the admin."
 *
 *   The member page decided a session was live like this:
 *
 *       const start = new Date(s.scheduledAt).getTime();
 *       const end   = start + s.durationMinutes * 60 * 1000;
 *       return now >= start && now < end;
 *
 *   Nothing in it asks whether the session was STARTED. The row carries
 *   `isActive` and the page declares it on its own interface and never reads
 *   it — but `isActive` would not have been enough either: the scheduling
 *   route writes `isActive: true` when the session is CREATED, with a
 *   `scheduledAt` in the future, so it means "not cancelled", not "running".
 *
 *   SO EVERY MEMBER'S ROOM OPENED THE MINUTE THE SCHEDULE SAID SO, whether or
 *   not an administrator had pressed Start.
 *
 *   AND THAT DECIDES WHO HOSTS. The classroom runs on public meet.jit.si with
 *   no JWT tenant (see CLASSROOM_JWT_IS_NOT_CONFIGURED), and such a room grants
 *   moderator to WHOEVER JOINS FIRST. `isModerator` is a claim the client makes
 *   to itself; the service never sees it. A member arriving at 10:00:03 for a
 *   10:00 session is the moderator, and the administrator who arrives at
 *   10:02 is an ordinary participant in his own event — which is exactly the
 *   report. The lobby cannot save it either: only a moderator may enable one.
 *
 * ── THE FIX, AND THE ONE COMPROMISE IN IT ───────────────────────────────────
 *
 *   `startWaveLiveSessionAction` now stamps `startedAt`, and the room opens
 *   from that stamp rather than from the schedule. The host is in the room
 *   before anybody is told they may enter, so the host is the moderator.
 *
 *   THE COMPROMISE: rows written before this stamp existed have no
 *   `startedAt`, and a live session in progress right now is one of them.
 *   Requiring the stamp outright would close the room under people currently
 *   in it. So a row WITHOUT the field falls back to the old clock rule — the
 *   behaviour it was written for — and only rows that could carry the stamp
 *   are held to it. The fallback is deliberately narrow: it is keyed on the
 *   field being ABSENT, not on it being falsy, so a session that has been
 *   ended does not reopen itself.
 */

/** The shape this rule needs. Anything else on the row is irrelevant here. */
export interface LiveSessionWindow {
    scheduledAt: string | number | Date;
    durationMinutes: number;
    /** Stamped when an administrator presses Start. Absent on legacy rows. */
    startedAt?: string | number | Date | null;
    /** False once the session has been ended, or cancelled. */
    isActive?: boolean;
}

const ms = (v: string | number | Date): number => {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : NaN;
};

/**
 * True when this session is open to attendees at `now`.
 *
 * `hasStartStamp` is read from the OBJECT rather than from the value, because
 * absence and null mean different things here: absence is a legacy row, null is
 * a row that carries the field and has not been started.
 */
export function isSessionOpen(session: LiveSessionWindow, now: number = Date.now()): boolean {
    //   An ended or cancelled session is closed, whatever the clock says.
    if (session.isActive === false) return false;

    const duration = Number(session.durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) return false;

    const hasStartStamp = Object.prototype.hasOwnProperty.call(session, "startedAt");

    if (hasStartStamp) {
        //   The row can carry the stamp, so it is held to it: not started is
        //   not open, regardless of the schedule.
        if (session.startedAt === null || session.startedAt === undefined) return false;
        const start = ms(session.startedAt);
        if (Number.isNaN(start)) return false;
        return now >= start && now < start + duration * 60_000;
    }

    //   LEGACY ROW. The rule it was written for, unchanged — see the header.
    const scheduled = ms(session.scheduledAt);
    if (Number.isNaN(scheduled)) return false;
    return now >= scheduled && now < scheduled + duration * 60_000;
}

/** The session a member should be shown right now, or null. */
export function findOpenSession<T extends LiveSessionWindow>(
    sessions: readonly T[],
    now: number = Date.now(),
): T | null {
    return sessions.find(s => isSessionOpen(s, now)) ?? null;
}
