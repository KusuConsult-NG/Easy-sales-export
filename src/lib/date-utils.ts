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

