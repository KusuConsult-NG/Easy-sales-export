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
 */
export async function canAccessWaveResources(
    userId: string,
    roles: string[] | undefined,
): Promise<boolean> {
    const memberDoc = await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(userId).get();
    if (memberDoc.exists && memberDoc.data()?.active) return true;

    if (isAdmin(roles)) return true;

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) return false;

    const academyReg = userDoc.data()?.serviceRegistrations?.academy;
    return academyReg?.plan === "elite"
        && (academyReg?.status === "approved" || academyReg?.status === "active");
}
