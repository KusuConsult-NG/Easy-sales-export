/**
 * Robust date formatting utility for the Easy Sales Export platform.
 * Handles various date-like inputs: Date objects, Firestore Timestamps (including serialized versions),
 * ISO strings, and numeric timestamps.
 */

/**
 * The same coercion as `toDate`, but null when the value is not a date.
 *
 * `toDate` falls back to `new Date()` — the current moment — which is right for
 * display, where showing today beats showing "Invalid Date". It is wrong for any
 * rule about ELAPSED TIME, because "we cannot tell when this happened" becomes
 * "it happened just now".
 *
 * reviews.ts is where that mattered: its 30-day edit window computed the age
 * from a hand-rolled coercion whose final fallback was `new Date()`, so a
 * createdAt shape it did not recognise made every review zero days old and
 * permanently editable. Callers enforcing a window should use this and refuse
 * when it returns null.
 */
export function toDateOrNull(date: any): Date | null {
    if (date === null || date === undefined || date === '') return null;

    // Handle Firestore Timestamp (client-side plain object or server-side class)
    if (typeof date === 'object') {
        if (typeof date.toDate === 'function') {
            const d = date.toDate();
            return d instanceof Date && !isNaN(d.getTime()) ? d : null;
        }
        if (typeof date.seconds === 'number') {
            return new Date(date.seconds * 1000);
        }
        // Admin-style Timestamps (firestore-compat) expose _seconds, and lose
        // their methods once serialized across the server/client boundary.
        if (typeof date._seconds === 'number') {
            return new Date(date._seconds * 1000);
        }
    }

    // Handle numeric timestamp or ISO string
    const d = new Date(date);
    return isNaN(d.getTime()) ? null : d;
}

export function toDate(date: any): Date {
    return toDateOrNull(date) ?? new Date();
}

/**
 * Formats a date-like input to a local date string (e.g., "MM/DD/YYYY").
 */
export function formatLocalDate(date: any): string {
    return toDate(date).toLocaleDateString();
}

/**
 * Formats a date-like input to a local date-time string.
 */
export function formatLocalDateTime(date: any): string {
    return toDate(date).toLocaleString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Date range boundary helpers (used for ALL Firestore server-side queries)
// Both functions produce explicit UTC timestamps so the server's local timezone
// never causes off-by-one range leakage.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODAY, AS THE PERSON LOOKING AT THE SCREEN RECKONS IT.
 *
 * #351. Admin date presets were built as `new Date().toISOString().slice(0, 10)`,
 * which is the UTC calendar date. Nigeria is UTC+1, so between 00:00 and 01:00
 * WAT the UTC date is still YESTERDAY: an admin who clicked "Today" at 00:30 on
 * the 4th got the 3rd's data under a button labelled Today, and "Last 7 days"
 * covered the seven days ending yesterday. "This year" was worse — its year came
 * from `getFullYear()` (LOCAL) and its end date from toISOString (UTC), so the
 * two halves of one range disagreed at the boundary.
 *
 * A preset names a day in the reader's calendar. #33 fixed the same confusion in
 * the query these strings feed; this is the other end of it.
 */
export function localCalendarDate(d: Date = new Date()): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Returns the UTC start of a given YYYY-MM-DD date string.
 * e.g. "2026-05-15" → 2026-05-15T00:00:00.000Z
 */
export function dateRangeStart(yyyyMmDd: string): Date {
    return new Date(yyyyMmDd + "T00:00:00.000Z");
}

/**
 * Returns the UTC end of a given YYYY-MM-DD date string (inclusive, end of day).
 * e.g. "2026-05-18" → 2026-05-18T23:59:59.999Z
 */
export function dateRangeEnd(yyyyMmDd: string): Date {
    return new Date(yyyyMmDd + "T23:59:59.999Z");
}



/**
 * ISO-8601 or a fallback, never a throw.
 *
 * Both of these lived at the top of the 5,604-line admin.ts and moved here when
 * it was split by domain. They are date formatters, not server actions, and
 * everything under src/app/actions must carry "use server" and export only
 * async functions — action-security-audit.test.ts enforces both — so the
 * actions tree is the wrong home for them.
 *
 * They differ from toDate/toDateOrNull above in what they return: a string for
 * a caller that is about to serialise, with an explicit fallback rather than a
 * RangeError on an unparseable value.
 */

/**
 *   #608 AND IT KNEW TWO OF THE FOUR SHAPES, SO IT ANSWERED "1970" FOR DATES IT
 *        COULD HAVE READ.
 *
 *   These two were written as `val.toDate?.() ?? new Date(val)`, which handles a
 *   live Timestamp and an ISO string and nothing else. A `{ seconds }` or
 *   `{ _seconds }` object — what an admin-side Timestamp becomes once it has
 *   crossed the server boundary, and the ordinary shape of a date stored in
 *   JSONB — made `new Date(val)` an Invalid Date, so the fallback was returned
 *   for a date that was sitting right there.
 *
 *   `toDateOrNull` two hundred lines above has known all four shapes for some
 *   time. #605 found sixty-five display sites not using it; these are the two
 *   SERIALISING readers, and they are the ones whose callers pass
 *   `new Date(0).toISOString()` as the fallback — so the cost was not a dash, it
 *   was a confident 1 January 1970 on an admin's user list and a member's
 *   certificate.
 */

export function safeToISOString(val: any, fallback: string): string {
    const d = toDateOrNull(val);
    return d ? d.toISOString() : fallback;
}

export function safeToISOStringOptional(val: any): string | undefined {
    return toDateOrNull(val)?.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// "There is no date here"
// ─────────────────────────────────────────────────────────────────────────────

/**
 *   #608 THE EPOCH IS THIS CODEBASE'S WORD FOR "UNKNOWN", AND SCREENS READ IT
 *        ALOUD AS 1 JANUARY 1970.
 *
 *   Twelve readers answer `new Date(0).toISOString()` when a row carries no
 *   date. That is a deliberate and CORRECT choice for ORDERING — a descending
 *   sort puts the epoch last, which is where an undated row belongs — and the
 *   certificates reader says why it was picked over the alternative:
 *
 *       // Only when the row genuinely carries no date. Defaulting to
 *       // "now" silently made every certificate look freshly issued.
 *
 *   Right about "now", and nobody followed the value to the screen. The same
 *   string is handed to the client and rendered by an ordinary date formatter,
 *   so a certificate with no issue date reads "Issued 01/01/1970" and a user
 *   with no createdAt joined the platform in 1970.
 *
 *   A sentinel is a value that means "no value". It is correct in the comparison
 *   it was chosen for and wrong everywhere it is read as itself, and nothing in
 *   the code separated those two uses.
 *
 *   SO IT IS NAMED, AND THE DISPLAY READERS BELOW TREAT IT AS ABSENT. Ordering
 *   is untouched: the value is still a real 0 and still sorts last.
 *
 *   THE RULE THIS ACCEPTS, STATED PLAINLY: an instant within a second of the
 *   Unix epoch cannot be displayed by this application. Nothing it records
 *   predates 2024, and every epoch value reaching a screen today comes from one
 *   of those twelve fallbacks. That trade is worth making explicit rather than
 *   leaving a reader to wonder why a date vanished.
 */
export const UNKNOWN_DATE = new Date(0);
export const UNKNOWN_DATE_ISO = UNKNOWN_DATE.toISOString();

/*
 *   NOT EVERY `new Date(0)` IS THIS. Deleting a cookie is done by setting its
 *   expiry to the epoch — `expires: new Date(0)` in auth.ts, three times — and
 *   that is the HTTP convention for "already expired", not this codebase's word
 *   for "no date". It stays as it is, and the ratchet on this constant is
 *   written narrowly enough not to drag it in.
 */

/** True when a value is this codebase's "no date" sentinel, in any of its shapes. */
export function isUnknownDate(value: unknown): boolean {
    const d = toDateOrNull(value);
    return d !== null && Math.abs(d.getTime()) < 1000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Showing a date to a person
// ─────────────────────────────────────────────────────────────────────────────

/**
 *   #597 SEVEN COPIES OF "FORMAT A DATE", NONE OF WHICH SURVIVED A DATE THAT
 *        WAS NOT ONE.
 *
 *   Ten member-facing screens build an `Intl.DateTimeFormat` by hand, in seven
 *   different local helpers, and every one of them ends in
 *
 *       .format(new Date(value))
 *
 *   `Intl.DateTimeFormat.prototype.format` THROWS A RangeError on an Invalid
 *   Date — it does not return "Invalid Date" the way `toString` does. So a row
 *   whose date field is absent, empty, or a string that does not parse takes the
 *   whole screen down, exactly as #589's missing occupation did.
 *
 *   Four of the seven guard `if (!val) return "—"`, which catches undefined and
 *   catches nothing else. Three guard nothing at all: /cooperatives/withdrawals,
 *   /cooperatives/my-savings and /cooperatives/my-loans each declare
 *   `formatDate(date: Date)` and are handed whatever the document held, because
 *   a TypeScript annotation is not a runtime check on a value that crossed the
 *   server boundary as JSON.
 *
 *   THE CRASH IS REAL AND WAS FOUND BY RENDERING, not by reading: the
 *   withdrawals screen was rendered with a row carrying only an id and threw
 *   "Invalid time value".
 *
 *   These go through `toDateOrNull`, which already knew how to read a Firestore
 *   Timestamp, a `_seconds` shape that lost its methods crossing the boundary,
 *   an ISO string and a number — so one reading rather than seven, and a dash
 *   rather than a blank page.
 *
 *   NOT `toDate`. That falls back to `new Date()`, which renders a missing date
 *   as TODAY: a quieter lie than a crash, and still a lie on a withdrawal
 *   request or a loan maturity.
 */
export function formatDateOrDash(
    value: unknown,
    options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" },
    fallback = "—",
    locale = "en-NG",
): string {
    const d = toDateOrNull(value);
    if (!d) return fallback;
    //   #608 — the epoch is the codebase's "no date", not a date. See
    //   UNKNOWN_DATE_ISO above for what this trade costs and why it is worth it.
    //
    //   THROUGH `isUnknownDate`, NOT A SECOND COPY OF ITS CONDITION. This line
    //   was `Math.abs(d.getTime()) < 1000` written out again, and a mutant that
    //   made only the formatter's copy one-sided SURVIVED — the two copies could
    //   disagree and every test still passed. Two hand-maintained copies of one
    //   rule is the defect this audit keeps finding in other people's code.
    if (isUnknownDate(d)) return fallback;
    try {
        return new Intl.DateTimeFormat(locale, options).format(d);
    } catch {
        return fallback;
    }
}

/** The same, with the time — the shape most of the copies used. */
export function formatDateTimeOrDash(value: unknown, fallback = "—", locale = "en-NG"): string {
    return formatDateOrDash(value, { dateStyle: "medium", timeStyle: "short" }, fallback, locale);
}

/**
 *   #605 AND SIXTY-THREE MORE COPIES, WRITTEN THE OTHER WAY.
 *
 *   #597 replaced seven hand-built `Intl.DateTimeFormat` helpers. It did not
 *   touch the far commoner spelling, which is a bare method call:
 *
 *       {new Date(order.createdAt).toLocaleDateString()}
 *       {new Date(update.timestamp).toLocaleString()}
 *
 *   `Date.prototype.toLocaleDateString` does NOT throw on an Invalid Date — it
 *   returns the literal string "Invalid Date" — so this spelling fails quietly
 *   where #597's threw loudly. That is the only reason it survived a commit
 *   whose whole subject was date formatting: nothing fell over, so nothing
 *   pointed at it.
 *
 *   IT IS NOT MERELY COSMETIC, AND THAT IS THE PART WORTH SAYING. `new Date(x)`
 *   understands an ISO string and a number and NOTHING ELSE. This codebase
 *   stores dates in four shapes — a Firestore Timestamp with `.toDate()`, a
 *   plain `{ seconds }` object, an admin-style `{ _seconds }` that lost its
 *   methods crossing the server boundary, and an ISO string from
 *   `serializeValue` — and `toDateOrNull` reads all four. Every site handed one
 *   of the first three was already printing "Invalid Date" to a person.
 *
 *   THREE SHAPES, ONE RULE. These wrappers exist so a call site keeps the
 *   appearance it had — a short numeric date, a date with a time, a time alone —
 *   without restating the coercion or inventing its own answer for "there is no
 *   date". `locale` is a parameter rather than a constant because the sweep
 *   preserved each screen's existing locale exactly; making certificates read
 *   "5 March" instead of "March 5" is a product decision, not a defect fix, and
 *   does not belong in the same commit as one.
 */

/** A short numeric date — what a bare `toLocaleDateString()` used to render. */
export function formatShortDateOrDash(value: unknown, fallback = "—", locale = "en-NG"): string {
    return formatDateOrDash(value, { year: "numeric", month: "2-digit", day: "2-digit" }, fallback, locale);
}

/** A time of day — what a bare `toLocaleTimeString()` used to render. */
export function formatTimeOrDash(value: unknown, fallback = "—", locale = "en-NG"): string {
    return formatDateOrDash(value, { hour: "2-digit", minute: "2-digit" }, fallback, locale);
}
