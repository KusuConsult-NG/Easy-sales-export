/**
 *   #395 A THIRD BULK-EMAIL SUBSYSTEM, COMPLETE, WITH A HISTORY SCREEN OF ITS
 *        OWN, AND NOT ONE ROW HAS EVER BEEN WRITTEN THROUGH IT.
 *
 *   THIS CORRECTS WHAT I SAID AT THE END OF #394. That commit recorded
 *   actions/admin-communications.ts as "a second BULK sender ... folding it
 *   into sendBatchEmailNotifications means re-deriving the delivered-vs-
 *   attempted counting", and I described it as the last remaining duplicate
 *   door to convert. That was wrong in the way that matters: it is not a door.
 *   Counting callers across all of src/ —
 *
 *        sendBulkEmailAction     0 live callers (1 test)
 *        getEmailHistoryAction   0 live callers, 0 tests
 *
 *   — neither has ever been reached. Converting them onto the shared sender
 *   would have been careful work on code that cannot run, and would have left
 *   two doors standing rather than one. "Which door is more featureful" is not
 *   the same question as "which door has ever run" (#384, #386); I asked the
 *   first one again and answered before measuring.
 *
 *   WHAT ACTUALLY SENDS A BROADCAST
 *   -------------------------------
 *   /admin/communications/broadcast posts to POST /api/admin/broadcast/send,
 *   which resolves recipients from filters, suppresses addresses in
 *   BOUNCED_EMAILS, adds List-Unsubscribe and Precedence: bulk headers, sends
 *   through sendBatchEmailNotifications, and writes a BROADCAST_LOGS row it
 *   updates with progress and a final status.
 *
 *   /admin/communications/history reads BROADCAST_LOGS through
 *   getBroadcastHistoryAction. So the screen an admin looks at is fed by the
 *   live path.
 *
 *   THE RETIRED PAIR, AND WHAT IT WOULD HAVE COST TO LEAVE IT
 *   ---------------------------------------------------------
 *   sendBulkEmailAction resolves recipients by SEGMENT through
 *   communicationsService.getTargetedUsers — whose only caller it is — sends
 *   with its own Resend client and its own chunking, and writes EMAIL_HISTORY.
 *   getEmailHistoryAction reads EMAIL_HISTORY back.
 *
 *   EMAIL_HISTORY therefore has exactly one writer and exactly one reader, and
 *   both are unreachable. The collection is empty and always has been. The
 *   hazard is not that it runs; it is that it is named exactly what somebody
 *   wiring a bulk-email screen would reach for, and wiring it would send
 *   broadcasts that skip the bounce list, carry no unsubscribe header, and
 *   land in a history nothing displays.
 *
 *   NOTHING IS LOST BY RETIRING IT. BROADCAST_LOGS carries strictly more than
 *   EMAIL_HISTORY did — subject, body, audience, filters, who sent it and
 *   their name, the recipient total, the bounce exclusions, the success and
 *   failure counts, and a status — so the live path already records everything
 *   the retired one would have.
 *
 *   RETIRED, NOT DELETED — the #379/#386 pattern
 *   --------------------------------------------
 *   Both actions refuse as their first statement, before the admin check runs.
 *   The implementations stay whole behind ADMIN_BULK_EMAIL_ACTION, off unless
 *   set to the exact word "enabled" — matching GDPR_PURGE_DELETE_AUTH,
 *   SEED_ALLOW_REMOTE, CLEANUP_ALLOW_REMOTE, MARKETPLACE_OFFLINE_CHECKOUT and
 *   ACADEMY_QUIZ_API. A specific word rather than a truthy value, so a stray
 *   "1" cannot arm a second broadcast path beside the live one.
 *
 *   Turning it on is not a wiring change. It is a decision to send bulk email
 *   without bounce suppression and without an unsubscribe header, which is a
 *   deliverability and compliance question rather than a technical one.
 */

/** The environment variable that arms the segment-based bulk email pair. */
export const ADMIN_BULK_EMAIL_ENV = "ADMIN_BULK_EMAIL_ACTION";

/** The one value that arms it. Anything else, including "1" and "true", does not. */
export const ADMIN_BULK_EMAIL_ENABLED_VALUE = "enabled";

/** Is the retired segment-based bulk email pair switched on? */
export function isAdminBulkEmailEnabled(): boolean {
    return process.env[ADMIN_BULK_EMAIL_ENV] === ADMIN_BULK_EMAIL_ENABLED_VALUE;
}

/**
 * What a caller is told, and what whoever enables this needs to know.
 *
 * Names the live path explicitly and the two protections the retired one
 * lacks, so a developer meeting this refusal does not have to work out either.
 */
export const ADMIN_BULK_EMAIL_REFUSAL =
    "This bulk email action is retired. Broadcasts are sent from "
    + "/admin/communications/broadcast through POST /api/admin/broadcast/send, "
    + "which suppresses bounced addresses and adds an unsubscribe header, and "
    + "are listed at /admin/communications/history from BROADCAST_LOGS.";
