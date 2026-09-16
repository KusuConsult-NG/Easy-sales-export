/**
 * The meeting link an admin pastes, made safe to put in an href.
 *
 *   #819 THE ADMIN'S LIVE SESSION WORKED AND EVERY MEMBER GOT A 404.
 *
 *   Reported by the owner: "the live session works for admin but the users live
 *   video is returning 404."
 *
 *   Go Live asks the admin to PASTE a link:
 *
 *       prompt("Please PASTE the Google Meet, Zoom, or Teams link URL below")
 *       const customMeetingLink = mode.trim();
 *
 *   and it was stored verbatim. The member's screen renders it directly:
 *
 *       <a href={event.meetingLink} target="_blank">Join Now</a>
 *
 *   A URL WITHOUT A SCHEME IS A RELATIVE PATH. Google displays a Meet link as
 *   `meet.google.com/abc-defg-hij`, and that is how it gets copied out of a
 *   calendar entry or typed from memory. The browser resolves it against the
 *   current page:
 *
 *       https://wave.easysalesexport.com/meet.google.com/abc-defg-hij   -> 404
 *
 *   WHY THE ADMIN NEVER SAW IT. Go Live sends the admin to
 *   /admin/wave/training/live/<eventId>, which opens the built-in classroom and
 *   never reads `meetingLink` at all. So the one person who could tell
 *   something was wrong was on the only path that does not use the broken
 *   value. That asymmetry is the whole shape of this defect.
 *
 * ── AND A `javascript:` URL WOULD HAVE RUN ──────────────────────────────────
 *
 *   The stored string went into an href untouched, so `javascript:…` in that
 *   prompt becomes script execution for every member who clicks Join Now. It is
 *   an admin-only input and this is not the likeliest attack in the codebase —
 *   but "only an admin can type it" is not a property of the href, and an admin
 *   account is exactly what gets phished. Only http and https survive here.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 *
 *   It does not check that the host is a real meeting provider. An admin may
 *   legitimately use a provider nobody listed, and a guess at the allow-list
 *   would refuse working links — the shape #789 found on the cooperative form,
 *   where a required field could not be satisfied. Scheme and parseability are
 *   what make the link WORK; which host is on the other end is the admin's
 *   call.
 */

/** What a pasted meeting link turns into. */
export type MeetingLinkResult =
    /** Nothing was pasted — the caller should use its built-in classroom. */
    | { kind: "empty" }
    /** A usable absolute http(s) URL. */
    | { kind: "ok"; url: string }
    /** Unusable, with a reason an admin can act on. */
    | { kind: "invalid"; reason: string };

/**
 * Normalise a pasted meeting link.
 *
 * @param raw whatever the admin typed or pasted.
 */
export function normaliseMeetingLink(raw: unknown): MeetingLinkResult {
    if (typeof raw !== "string") return { kind: "empty" };

    const trimmed = raw.trim();
    if (!trimmed) return { kind: "empty" };

    /*
     *   A scheme-relative URL — `//meet.google.com/x` — is a real absolute URL
     *   to a browser, but it inherits the page's scheme and reads like a path.
     *   Treated as a bare host, which is what somebody pasting it means.
     */
    const withoutLeadingSlashes = trimmed.replace(/^\/{2,}/, "");

    /*
     *   THE SCHEME CHECK COMES FIRST, before anything is prefixed, and it is
     *   NOT made redundant by the hostname check below.
     *
     *   MUTATION-TESTED: deleting this SURVIVED the first draft of the suite,
     *   because every `javascript:` URL that draft tried had no host and was
     *   refused lower down. But a scheme can carry one — measured:
     *
     *       new URL("javascript://evil.example.com/%0aalert(1)").hostname
     *         === "evil.example.com"
     *
     *   so that spelling sails past the hostname guard, and the newline turns
     *   the rest into script. Only this check stops it, and the suite now has
     *   that case because the mutation is what revealed it.
     */
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(withoutLeadingSlashes)?.[1]?.toLowerCase();
    if (scheme && scheme !== "http" && scheme !== "https") {
        return {
            kind: "invalid",
            reason: `A meeting link must start with https:// — "${scheme}:" links are not accepted.`,
        };
    }

    /*
     *   No scheme means the admin pasted a bare host, which is how Google, Zoom
     *   and Teams all display their links. THIS IS THE DEFECT: left alone it
     *   becomes a relative path and every member gets a 404.
     */
    const candidate = scheme ? withoutLeadingSlashes : `https://${withoutLeadingSlashes}`;

    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return { kind: "invalid", reason: "That does not look like a meeting link. Paste the full URL." };
    }

    //   A URL with no host — `https:///x` — parses but goes nowhere.
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
        return { kind: "invalid", reason: "That link has no website address in it. Paste the full URL." };
    }

    return { kind: "ok", url: parsed.toString() };
}

/**
 * Is this value safe to put straight into an href?
 *
 * For READ paths rendering links already stored by an earlier version, which
 * normaliseMeetingLink never saw. A stored relative path is not repaired here —
 * this only answers whether it may be linked at all.
 */
export function isSafeMeetingHref(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const v = value.trim();
    if (!v) return false;

    /*
     *   AN APP-RELATIVE PATH IS FINE AND IS THE COMMON CASE. When the admin
     *   leaves the prompt blank, the link stored is `/wave/live-training` or
     *   `/academy/live/<id>` — this application's own built-in classroom.
     *
     *   The first draft of this function rejected those, which would have
     *   hidden the Join button for every session using the built-in classroom:
     *   a worse defect than the one being fixed, introduced while fixing it.
     *   Its own test caught it.
     *
     *   EXACTLY ONE leading slash. `//meet.google.com/x` is protocol-relative —
     *   it leaves this origin — so it is not an app path and falls through.
     */
    if (v.startsWith("/") && !v.startsWith("//")) return true;

    /*
     *   Otherwise it must be ABSOLUTE. Parsed with NO BASE, deliberately: the
     *   first draft passed `"https://placeholder.invalid"` as a base, which
     *   RESOLVES a relative value instead of rejecting it — so
     *   `meet.google.com/abc` came back with protocol `https:` and was declared
     *   safe. That is precisely the value this guard exists to catch.
     */
    try {
        const { protocol } = new URL(v);
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}
