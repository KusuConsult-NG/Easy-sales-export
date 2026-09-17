import { logger } from "@/lib/logger";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Where to send a notice, when the caller does not carry an address.
 *
 *   #862 THE THIRD COPY WAS NOT WRITTEN.
 *
 *   loan-decision-notice.ts and member-decision-notice.ts each held a private
 *   `resolveEmail` — identical but for the log prefix — and adding a Farm Nation
 *   notifier meant a third. Two copies of a rule is how this audit's most common
 *   defect starts: a correct rule applied to SOME of the places it names, then
 *   repaired in one copy and not the others.
 *
 *   The rule itself is small and worth keeping exactly once:
 *
 *     - An address the caller already holds WINS. It came off the record the
 *       notice is about — a loan, a listing — and is what that transaction was
 *       agreed with.
 *     - Otherwise read the user. Nine callers in this codebase reach a notifier
 *       with a userId and nothing else.
 *     - A failed lookup RETURNS NOTHING rather than throwing. Every caller is
 *       past the point of no return by the time it asks — the decision is
 *       committed, the inspector is dispatched — so "we could not find an
 *       address" must never become "the operation failed".
 *
 *   NOT `resolveActiveUserId` FIRST, deliberately. infrastructure/notifications
 *   already redirects the in-app notice to a superseded profile's live row
 *   (#738), and it does that because a bell notice is READ IN THE APP the person
 *   signs into. An email address is not a profile — the address on a superseded
 *   row is usually the same person's inbox, and where it is not, sendEmail's own
 *   guards (#737's tombstone test, #694's bounce list) refuse it downstream.
 */
export async function resolveNoticeEmail(
    context: string,
    userId: string,
    given?: string | null,
): Promise<string | undefined> {
    if (typeof given === "string" && given.trim()) return given;
    if (!userId) return undefined;

    try {
        const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const email = snap.exists ? (snap.data() ?? {}).email : undefined;
        return typeof email === "string" && email.trim() ? email : undefined;
    } catch (error) {
        logger.error(`[${context}] could not resolve an address for the notice`, { userId, error });
        return undefined;
    }
}
