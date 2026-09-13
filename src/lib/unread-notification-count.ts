import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { NOTIFICATION_BADGE_WINDOW } from "@/lib/notification-filter";

/**
 *   THE ONE RULE FOR "HOW MANY UNREAD NOTIFICATIONS DOES THIS MEMBER HAVE".
 *
 *   #416 found two badges counting one fact differently and made them agree by
 *   construction. #687 found a THIRD count — `users.unreadCount`, a
 *   denormalised counter the notification service maintained — which disagreed
 *   with both, was bypassed by five of the platform's notification writers, and
 *   was read by one function that nothing called.
 *
 *   So the rule is stated ONCE, here, and every count comes through it:
 *
 *       unread rows addressed to this member, newest first,
 *       capped at NOTIFICATION_BADGE_WINDOW.
 *
 *   THE CAP IS PART OF THE RULE, NOT AN IMPLEMENTATION DETAIL. The bell renders
 *   the same window and counts the unread among them, so a count taken without
 *   the cap is a number the panel below it can never be made to match — which
 *   is exactly the badge-you-cannot-clear #416 was about.
 *
 *   NO SUBSCRIPTION FILTER IS APPLIED. #634: every row here was written to this
 *   userId on purpose, and dropping the ones from a module the member is not
 *   registered for hid people's own mail from them.
 *
 *   SERVER ONLY. It touches the database; the client-safe half of the rule —
 *   the window size and the visibility predicate — lives in
 *   lib/notification-filter.ts, which components may import and this may not
 *   replace.
 */
export async function countUnreadNotifications(userId: string): Promise<number> {
    if (!userId) return 0;

    try {
        const snap = await db
            .collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .where("read", "==", false)
            .orderBy("createdAt", "desc")
            .limit(NOTIFICATION_BADGE_WINDOW)
            .get();

        //   Every row this query returned is unread and belongs to this member
        //   — that IS the count.
        return snap.docs.length;
    } catch (error) {
        /*
         *   Zero on failure, deliberately, and logged.
         *
         *   This is the number on a badge. There is no honest way to render
         *   "could not tell" on one, and a stale-but-plausible figure invented
         *   here would be worse than none — #620's class. The caller that polls
         *   it keeps the count it already had rather than resetting to zero, so
         *   a transient failure does not blink the badge off; that behaviour is
         *   in useUnreadNotifications and is asserted by #416's suite.
         */
        logger.error("[notifications] unread count failed", { userId, error });
        return 0;
    }
}
