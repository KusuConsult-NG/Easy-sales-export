import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { SupabaseQuerySnapshot } from "@/lib/supabase-db";
import { phoneLookupVariants } from "@/lib/phone";
import { logger } from "@/lib/logger";

/**
 * Searches the users collection by email, phone, or name prefix.
 * Returns a list of matching user IDs (up to 30, which is the limit for 'in' operator in Firestore).
 */
/**
 * How many matching members one search may return.
 *
 * Thirty is the `in`-clause limit these callers build their queries on, not a
 * preference — raising it would make the queries illegal rather than slower.
 */
export const SEARCH_RESULT_CAP = 30;

export async function searchUserIdsByQuery(searchQuery: string): Promise<string[]> {
    if (!searchQuery) return [];
    const q = searchQuery.trim().toLowerCase();
    const userIds = new Set<string>();

    try {
        // 1. Exact email match
        const emailSnap = await db.collection(COLLECTIONS.USERS)
            .where("email", "==", q)
            .limit(30)
            .get();
        emailSnap.docs.forEach(doc => userIds.add(doc.id));

        if (userIds.size >= SEARCH_RESULT_CAP) return Array.from(userIds).slice(0, SEARCH_RESULT_CAP);

        // 2. Phone matches — exact AND prefix (so "0803" finds "08035678901")
        const rawPhone = searchQuery.trim();
        /*
         *   #729 — EVERY SPELLING, SO AN ADMIN FINDS THE MEMBER THEY HAVE.
         *
         *   The users collection holds one number under several spellings —
         *   lib/phone.ts lists the four writers responsible — so an admin who
         *   pasted `+2348035678901` did not find a member whose row the bulk
         *   import wrote as `08035678901`. The prefix ranges below do not cover
         *   it either: they extend the string to the RIGHT, and these spellings
         *   differ on the left.
         *
         *   Lower stakes than the dedup guards this finding is mostly about —
         *   nobody gets a second account out of a search box — but it is the
         *   same question asked of the same collection, and an admin who cannot
         *   find a member concludes the member is not there.
         *
         *   PARTIALS ARE UNAFFECTED. phoneLookupVariants cannot normalise
         *   "0803", so it returns just ["0803"] and this degrades to exactly
         *   the single exact match it replaced, leaving the prefix ranges to do
         *   the work they were added for.
         */
        const phoneForms = phoneLookupVariants(rawPhone);
        const phonePromises: Promise<SupabaseQuerySnapshot>[] = [
            // Exact match on both field names, across every stored spelling
            ...(phoneForms.length > 0 ? [
                db.collection(COLLECTIONS.USERS).where("phone", "in", phoneForms).limit(30).get(),
                db.collection(COLLECTIONS.USERS).where("phoneNumber", "in", phoneForms).limit(30).get(),
            ] : []),
            // Prefix range on phone field
            db.collection(COLLECTIONS.USERS)
                .where("phone", ">=", rawPhone)
                .where("phone", "<=", rawPhone + "\uf8ff")
                .limit(30).get(),
            // Prefix range on phoneNumber field
            db.collection(COLLECTIONS.USERS)
                .where("phoneNumber", ">=", rawPhone)
                .where("phoneNumber", "<=", rawPhone + "\uf8ff")
                .limit(30).get(),
        ];
        const phoneSnaps = await Promise.all(phonePromises);
        phoneSnaps.forEach(snap => snap.docs.forEach(doc => userIds.add(doc.id)));

        if (userIds.size >= SEARCH_RESULT_CAP) return Array.from(userIds).slice(0, SEARCH_RESULT_CAP);

        // 3. Name prefix matches (multi-casing variations in parallel)
        const capitalizedQ = searchQuery.trim()
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        const uppercaseQ = searchQuery.trim().toUpperCase();
        const rawQ = searchQuery.trim();

        // Collect all distinct query values
        const searchVariations = Array.from(new Set([
            capitalizedQ,
            q,
            uppercaseQ,
            rawQ
        ])).filter(Boolean);

        const namePromises: Promise<SupabaseQuerySnapshot>[] = [];
        for (const val of searchVariations) {
            namePromises.push(
                db.collection(COLLECTIONS.USERS)
                    .where("fullName", ">=", val)
                    .where("fullName", "<=", val + "\uf8ff")
                    .limit(30)
                    .get()
            );
            namePromises.push(
                db.collection(COLLECTIONS.USERS)
                    .where("firstName", ">=", val)
                    .where("firstName", "<=", val + "\uf8ff")
                    .limit(30)
                    .get()
            );
            namePromises.push(
                db.collection(COLLECTIONS.USERS)
                    .where("lastName", ">=", val)
                    .where("lastName", "<=", val + "\uf8ff")
                    .limit(30)
                    .get()
            );
        }

        const nameSnaps = await Promise.all(namePromises);
        nameSnaps.forEach(snap => {
            snap.docs.forEach(doc => userIds.add(doc.id));
        });
    } catch (err) {
        /*
         *   #786 A FAILED SEARCH LOOKED EXACTLY LIKE "NO SUCH MEMBER".
         *
         *   Reported by the owner: "Sorting/filtering by applicant name in the
         *   WAVE Admin Dashboard is not functioning correctly and returns an
         *   error."
         *
         *   This caught, wrote one line to the console, and RETURNED WHATEVER
         *   IT HAD — which is `[]` when the failure happened on the first
         *   query, or an email-only partial when it happened on the name ones.
         *   Every one of the nine callers then does the same thing with an
         *   empty list:
         *
         *       if (matchingUserIds.length === 0) return { data: [] }
         *
         *   So an admin searching for a member who IS there was shown an empty
         *   table and told nothing. Nine admin screens across seven modules
         *   share this helper, so the behaviour is platform-wide: the WAVE
         *   dashboard is simply where it was noticed.
         *
         *   IT THROWS NOW. Every caller is already inside a try/catch that
         *   turns an exception into a failed ActionResponse, so the screens
         *   report "search failed" instead of "no results" — which is the
         *   difference between an admin retrying and an admin concluding the
         *   member does not exist.
         *
         *   #743's ledger names this exact shape: a catch that swallows the
         *   failure. Returning a partial silently is the same defect wearing
         *   the successful-looking half of the answer.
         */
        logger.error("[searchUserIdsByQuery] the user search failed", {
            reason: err instanceof Error ? err.message : String(err),
        });
        throw new Error("The member search could not be completed. Please try again.");
    }

    /*
     *   #786 AND THE CAP IS REPORTED, not applied in silence.
     *
     *   Sixty-one members share a surname; this returns thirty of them and the
     *   screen renders those thirty as though they were all of them. #772 is
     *   this codebase's record of what a sample presented as a total costs. The
     *   caller cannot fix the cap — it is what keeps an `in` clause legal — but
     *   it can say so, which is what SEARCH_RESULT_CAP is exported for.
     */
    const all = Array.from(userIds);
    if (all.length > SEARCH_RESULT_CAP) {
        logger.warn(
            `[searchUserIdsByQuery] "${searchQuery}" matched ${all.length} members; ` +
            `returning the first ${SEARCH_RESULT_CAP}. The screen shows a partial list.`,
        );
    }
    return all.slice(0, SEARCH_RESULT_CAP);
}

/**
 * True when this result was cut short by the cap.
 *
 * Exported so a screen can say "showing the first 30 matches" rather than
 * presenting a truncated list as a complete one.
 */
export function searchWasTruncated(ids: readonly string[]): boolean {
    return ids.length >= SEARCH_RESULT_CAP;
}
