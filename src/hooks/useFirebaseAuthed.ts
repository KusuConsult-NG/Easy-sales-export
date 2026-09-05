"use client";

/**
 *   #418 A GUARD THAT ALWAYS RETURNS TRUE, AND NOTHING LEFT TO GUARD.
 *
 *   `useFirebaseAuthed(userId)` ignores its argument and returns the literal
 *   `true`. Its own header called it a "Legacy Firebase Authentication Guard
 *   (Shimmed)" — accurate, and exactly the shape #331 is about: a check that
 *   cannot fail reads, at every call site, like a check.
 *
 *   NOT A LIVE HOLE. Nothing imports it — checked across src, e2e and scripts —
 *   so no screen is relying on it today. What made it worth a note rather than
 *   silence is that it is a one-import change away from LOOKING like it
 *   protects something: `if (!useFirebaseAuthed(uid)) return <Denied/>` would
 *   read as a gate and admit everybody. This platform authenticates through
 *   NextAuth; there is no Firebase auth left for it to consult.
 *
 *   KEPT, NOT DELETED — the standing rule here. It is retired in place: it now
 *   refuses to answer instead of answering "yes", so a caller wired to it fails
 *   loudly at the moment it is wired rather than silently admitting everyone.
 *   That is #3's rule for shims, applied to the last one that still lied.
 */
export function useFirebaseAuthed(_userId?: string | undefined): never {
    throw new Error(
        "useFirebaseAuthed is retired (#418): it always answered true and guarded nothing. "
        + "This platform authenticates through NextAuth — use useSession(), and for module "
        + "access use useMembershipStatus or the server-side requireSession/hasAdminPermission.",
    );
}
