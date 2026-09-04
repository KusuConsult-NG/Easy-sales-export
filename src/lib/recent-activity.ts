/**
 * When was this account last active?
 *
 *   #273 ONE EXPRESSION, SIX PLACES, AND IT HAD ALREADY DRIFTED.
 *
 *        "Recently active" was written out at six sites — five in
 *        broadcast-logic.ts and one in sms-broadcast.ts — and ONE of them read
 *
 *            updatedAt || lastLoginAt || createdAt
 *
 *        while the other five read `updatedAt || createdAt`. Nothing in this
 *        repository writes `lastLoginAt` (#335), so the odd copy behaved the
 *        same as the rest and the drift was invisible — which is exactly the
 *        state a duplicate sits in right up until somebody changes one of them.
 *
 *        That is #270/#271/#336's shape: one quantity, several spellings. The
 *        expression lives here now and the six sites ask it.
 *
 * WHY updatedAt IS THE RIGHT KEY, stated rather than left to be re-derived:
 * it is a NATIVE column on users (supabase-table-map.ts) and every write
 * touches it, so it is the only field on the row that actually tracks activity.
 * `createdAt` is the fallback for an account written once and never since.
 *
 * This module imports nothing, so a screen can ask it too.
 */

/** The shapes a timestamp arrives in on this platform. */
type Stamp = { toDate?: () => Date } | string | number | Date | null | undefined;

/** A row as this rule reads it. */
export interface MaybeActiveRecord {
    updatedAt?: Stamp;
    createdAt?: Stamp;
    [key: string]: unknown;
}

/**
 * The most recent evidence that this account was active, or null when the row
 * carries none.
 *
 * Returns null rather than a date for an unusable value. A record whose only
 * timestamp is unparseable has not been shown to be active, and defaulting to
 * "now" would sweep it into every recent-activity audience — the fail-open this
 * codebase keeps finding.
 */
export function lastActiveAt(record: MaybeActiveRecord | null | undefined): Date | null {
    const raw = record?.updatedAt ?? record?.createdAt;
    if (!raw) return null;

    const value = typeof raw === "object" && raw !== null && "toDate" in raw
        && typeof (raw as { toDate?: () => Date }).toDate === "function"
        ? (raw as { toDate: () => Date }).toDate()
        : new Date(raw as string | number | Date);

    return Number.isNaN(value.getTime()) ? null : value;
}

/** The window every "active in the last N days" audience uses. */
export const RECENT_ACTIVITY_DAYS = 30;

/** Was this account active within the window? A row with no evidence is not. */
export function isRecentlyActive(
    record: MaybeActiveRecord | null | undefined,
    days: number = RECENT_ACTIVITY_DAYS,
    now: Date = new Date(),
): boolean {
    const active = lastActiveAt(record);
    if (!active) return false;

    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return active >= cutoff;
}
