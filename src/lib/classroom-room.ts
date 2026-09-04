/**
 * What names a live classroom, and why it may not be derived from anything.
 *
 *   #188 THE IN-APP CLASSROOM WAS A PUBLIC ROOM WITH A GUESSABLE NAME.
 *
 *        VideoClassroom opens a room on meet.jit.si — a public, open instance
 *        with no JWT — and the room name was computed IN THE BROWSER from an
 *        identifier that is on every URL of the platform:
 *
 *          /academy/live/[courseId]     roomName={`academy-${courseId}`}
 *          admin/academy/live/[courseId]      `academy-${courseId}`
 *          admin/wave/training/live/[eventId] `wave-training-${eventId}`
 *          _wv_admin_live.ts (the stored row)  `wave-training-${eventId}`
 *
 *        and the component prefixed `EasySalesExport-`. So the room for any
 *        paid live class was `EasySalesExport-academy-<courseId>`, and the
 *        course id is in the catalogue link. ANYBODY who had ever seen a course
 *        page — or who tried ids until one worked — could type that room name
 *        into meet.jit.si and be in the class, WITH NO ACCOUNT AT ALL.
 *
 *        #267 had already established that a meeting link is a bearer
 *        credential and stripped `meetingLink`, `customMeetingLink` and
 *        `recordingUrl` from an un-entitled learner's copy of the session row.
 *        The built-in classroom went around that entirely: it needed no link,
 *        because the browser could compute the room from the course id.
 *
 *   WHAT WAS DECIDED, AND WHAT IT DOES AND DOES NOT CLOSE
 *
 *        The recorded finding said closing this needs a JWT-gated deployment
 *        (JaaS) or a moderator lobby, and called it a hosting decision. Half of
 *        that is a hosting decision. The other half is not, and it is the half
 *        that was actually broken:
 *
 *          THE ROOM NAME IS NOW A SERVER-MINTED SECRET (128 bits), stored on
 *          the live-session row and handed out ONLY through the reader that
 *          already applies the entitlement check. It is not derived from the
 *          course id, the event id, the title, or anything else a person can
 *          see. Guessing it is guessing a 128-bit random number.
 *
 *          THE MODERATOR TURNS THE LOBBY ON. The component did the opposite —
 *          `executeCommand("toggleLobby", false)` for a moderator, and nothing
 *          ever turned it on — so the one gate the public instance does offer
 *          was explicitly disabled. Somebody arriving now waits to be admitted.
 *
 *        WHAT REMAINS OPEN, STATED PLAINLY: meet.jit.si does not authenticate
 *        participants, so anybody who is GIVEN the room name by an entitled
 *        learner can still reach the lobby. Only a JWT deployment binds a
 *        participant to an account, and that is a hosting and cost decision
 *        this code cannot take. The lobby is the compensating control until
 *        then, and CLASSROOM_JWT_IS_NOT_CONFIGURED below is the marker to find
 *        when it is.
 *
 * This module is pure and imports nothing, so a suite that mocks the database
 * layer cannot break it — #381's lesson.
 */

/**
 * The prefix every room this platform opens carries.
 *
 * It is a NAMESPACE, not a secret: meet.jit.si is a shared instance, and
 * without it "abc123" could collide with somebody else's meeting. The secret
 * is the part after it.
 */
export const CLASSROOM_ROOM_PREFIX = "EasySalesExport";

/** Bytes of randomness in a room key. 16 bytes = 128 bits = 32 hex characters. */
export const CLASSROOM_ROOM_KEY_BYTES = 16;

/** The exact shape a minted key has. Anything else is refused. */
export const CLASSROOM_ROOM_KEY_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Is this a real minted room key, rather than something derived from an id?
 *
 * THE CHECK IS THE MINTED SHAPE, NOT AN EXCLUSION LIST. A list of forbidden
 * prefixes — "academy-", "wave-training-" — would have to be extended every
 * time a new caller invents a fifth naming scheme, and the one that got
 * forgotten would be the one that shipped. Only the shape a mint produces
 * passes, so every derived name fails by construction.
 */
export function isMintedRoomKey(key: unknown): key is string {
    return typeof key === "string" && CLASSROOM_ROOM_KEY_PATTERN.test(key);
}

/**
 * The full room name for a key, or null if the key is not a minted one.
 *
 * Returning null rather than a fallback name is the point: a caller with no
 * usable key must show the learner that the classroom is not open, NOT open a
 * room under a name it made up. The made-up name is the defect.
 */
export function classroomRoomName(key: unknown): string | null {
    return isMintedRoomKey(key) ? `${CLASSROOM_ROOM_PREFIX}-${key}` : null;
}

/**
 * The four expressions that used to name a room, kept as a record of what must
 * never name one again.
 *
 * These are not used to VALIDATE anything — isMintedRoomKey does that by shape,
 * which covers names nobody has invented yet. They are here so the sweep in
 * academy-classroom-is-not-guessable.test.ts can assert that no source file
 * builds a room name this way any more, and so the next reader knows what the
 * defect looked like rather than having to reconstruct it.
 */
export const RETIRED_ROOM_NAME_EXPRESSIONS: readonly string[] = [
    "academy-${courseId}",
    "wave-training-${eventId}",
    "EasySalesExport-${roomName}",
    "wave-training-${Date.now()}",
];

/**
 * The marker to search for when a JWT-gated deployment is bought.
 *
 * Everything that would need to change to bind a participant to an account
 * carries this string, so the work is a grep rather than an archaeology
 * exercise. It is a comment marker, not a runtime flag: there is nothing to
 * switch on until a tenant exists.
 */
export const CLASSROOM_JWT_IS_NOT_CONFIGURED =
    "meet.jit.si does not authenticate participants; a JWT tenant would";
