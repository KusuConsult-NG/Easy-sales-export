/**
 * When a notification stops being news.
 *
 *   #615 NOTHING AGED A NOTIFICATION OUT, AND ONE SCREEN SHOWED TWO MONTHS OF
 *        THEM IN A SINGLE COLUMN.
 *
 *   #534 recorded the symptom exactly: "It asked for 200 and rendered every one,
 *   on an eight-second poll. The owner opened it and got two months of 'New WAVE
 *   Application' in a single column, back to the first submission — notifyAdmins
 *   writes one row per admin per application, nothing ages a notification out,
 *   and this screen put no window on what it showed."
 *
 *   #534 fixed the SCREEN — a page at a time, with Show more — and said plainly
 *   that the store still grows without bound. This is the other half.
 *
 * ── NOTHING IS DELETED ──────────────────────────────────────────────────────
 *
 *   An aged notification is MARKED, not removed. `archived: true` and
 *   `archivedAt` go onto the row; every field it had, it keeps. Clearing the
 *   flag puts it back. That is the standing rule for this codebase and it is
 *   also the right engineering: a notification is the only record that somebody
 *   was told something, and "we told them and then deleted the evidence" is a
 *   worse position than a long list.
 *
 * ── TWO WINDOWS, NOT ONE ────────────────────────────────────────────────────
 *
 *   A READ notification has done its job. Thirty days is generous for something
 *   the person has already seen and acted on.
 *
 *   An UNREAD one has not, and #594's note on this very screen is the reason to
 *   be careful: "A notification is how this platform tells somebody an order was
 *   disputed, a loan was approved, a withdrawal failed." Hiding one of those
 *   because it is old would be the same class of harm as the blank page that
 *   note was written about. So unread rows get six months — long enough that
 *   anything still unread is genuinely historical, and short enough that the
 *   pile stops being the reason nobody reads the list.
 *
 *   THE ASYMMETRY IS THE POINT. One window for both would have to be the longer
 *   one to be safe, and then it would not solve #534's pile, which is mostly
 *   read-and-ignored admin chatter.
 *
 * ── WHAT THIS DOES NOT DECIDE ───────────────────────────────────────────────
 *
 *   Whether a notification should have been written at all. notifyAdmins writes
 *   one row PER ADMIN PER APPLICATION, which is why the pile is the size it is,
 *   and changing that is a product decision about who should be told what. This
 *   ages what exists; it does not reduce what arrives, and pretending otherwise
 *   would leave the real cause unexamined.
 */

import { toDateOrNull } from "./date-utils";

/** How long a notification stays on the list, by whether it was read. */
export const NOTIFICATION_ARCHIVE_AFTER_DAYS: Readonly<{ read: number; unread: number }> = {
    read: 30,
    unread: 180,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AgeingDecision =
    | { archive: true; ageDays: number; allowedDays: number }
    | { archive: false; reason: "already_archived" | "no_timestamp" | "still_current" };

/**
 * Should this notification come off the list?
 *
 * Reads the date through `toDateOrNull`, so all four shapes this codebase stores
 * are understood — #605's finding, and the reason a row is not archived merely
 * because its timestamp arrived as `{ _seconds }`.
 *
 * A row with NO usable date is never archived. "We cannot tell how old this is"
 * must not become "it is old enough to hide", which is the elapsed-time lie
 * `toDateOrNull` exists to prevent.
 */
export function ageingDecision(
    notification: { read?: unknown; archived?: unknown; createdAt?: unknown },
    now: Date = new Date(),
): AgeingDecision {
    if (notification.archived === true) {
        return { archive: false, reason: "already_archived" };
    }

    const created = toDateOrNull(notification.createdAt);
    if (!created) {
        return { archive: false, reason: "no_timestamp" };
    }

    const allowedDays = notification.read === true
        ? NOTIFICATION_ARCHIVE_AFTER_DAYS.read
        : NOTIFICATION_ARCHIVE_AFTER_DAYS.unread;

    const ageDays = (now.getTime() - created.getTime()) / MS_PER_DAY;
    if (!(ageDays > allowedDays)) {
        return { archive: false, reason: "still_current" };
    }

    return { archive: true, ageDays, allowedDays };
}

/** The fields that mark a row archived. Written by the job, read by the list. */
export function archivedFields(now: Date = new Date()): Record<string, unknown> {
    return { archived: true, archivedAt: now.toISOString() };
}

/**
 * Is this row one a member should still see?
 *
 * The list filters on this rather than on `archived !== true` spelled out at
 * each call site, because that is the rule that drifts — #439, and the reason
 * every other shared reading in this codebase exists.
 */
export function isOnTheList(notification: { archived?: unknown }): boolean {
    return notification.archived !== true;
}
