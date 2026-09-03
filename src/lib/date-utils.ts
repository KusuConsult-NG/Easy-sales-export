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

export function safeToISOString(val: any, fallback: string): string {
    if (!val) return fallback;
    try {
        let d;
        if (val.toDate && typeof val.toDate === "function") {
            d = val.toDate();
        } else {
            d = new Date(val);
        }
        if (isNaN(d.getTime())) return fallback;
        return d.toISOString();
    } catch {
        return fallback;
    }
}

export function safeToISOStringOptional(val: any): string | undefined {
    if (!val) return undefined;
    try {
        let d;
        if (val.toDate && typeof val.toDate === "function") {
            d = val.toDate();
        } else {
            d = new Date(val);
        }
        if (isNaN(d.getTime())) return undefined;
        return d.toISOString();
    } catch {
        return undefined;
    }
}
