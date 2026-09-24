import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * Who may reach the WAVE resource library — ONE definition.
 *
 * WHY THIS EXISTS
 * ---------------
 * The rule was twenty lines inline in getWaveResourcesAction and nowhere else,
 * while a second action over the same collection —
 * incrementResourceDownloadAction, which writes — had NO membership check at
 * all: any authenticated account could bump the download counter of any
 * resource id, enrolled or not. Copying twenty lines across is how #38 got four
 * copies of the WAVE eligibility rule with three different behaviours, so it
 * moves here instead.
 *
 * WHAT THE RULE IS
 * ----------------
 * An active WAVE member, an admin, or an Academy Elite member. That is the rule
 * the listing already applied; it is reproduced exactly, not tightened, so the
 * listing behaves as it did and the download path gains the check it lacked.
 *
 * NOT checkWaveEligibility, which answers a different question — who may APPLY
 * to the programme. Someone can be eligible to apply and not yet be a member,
 * and a member remains a member regardless of eligibility. Merging the two
 * would let an applicant read the members' library.
 *
 * ── THE ADMIN BRANCH ASKED THE TOKEN, AND IT COST NOTHING TO ASK THE ROW ────
 *
 *   It was `isAdmin(roles)`, with both call sites passing
 *   `session.user.roles`. That is #356's class: a JWT role claim keeps its
 *   value for up to eight hours after the database loses it, so a revoked
 *   admin went on reading the members' library and bumping download counters
 *   for the rest of their session.
 *
 *   What makes this one worth doing rather than recording is that the live
 *   read was ALREADY HAPPENING three lines below — the Academy branch fetches
 *   the user document anyway. The token was being trusted beside a row that
 *   held the answer. Fetching once and using it for both questions removes the
 *   stale gate for the price of one read on the admin path, and no extra read
 *   on any other.
 *
 *   `roles` stays in the signature and is ignored, so neither caller changes
 *   and nothing can pass a token claim in by accident and have it believed.
 */
export async function canAccessWaveResources(
    userId: string,
    /**
     * IGNORED. Kept so the two call sites compile unchanged; the roles that
     * decide this come from the user's row, below. See the note above.
     */
    _roles?: string[] | undefined,
): Promise<boolean> {
    const memberDoc = await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(userId).get();
    if (memberDoc.exists && memberDoc.data()?.active) return true;

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) return false;

    const userData = userDoc.data() ?? {};

    //   LIVE, from the row this function was already reading.
    if (isAdmin(userData.roles)) return true;

    const academyReg = userData.serviceRegistrations?.academy;
    return academyReg?.plan === "elite"
        && (academyReg?.status === "approved" || academyReg?.status === "active");
}
