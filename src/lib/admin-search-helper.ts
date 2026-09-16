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

/**
 * Search a collection by the name fields IT carries, rather than the user's.
 *
 *   #814 THE ADMIN SEARCHED THE NAME ON THE SCREEN AND THE CODE LOOKED
 *   SOMEWHERE ELSE.
 *
 *   Reported by the owner: "AISHAT Yahaya ABUBAKAR and others are registered
 *   with pending status and when searched they return user not found."
 *
 *   The WAVE applications table prints the name from the APPLICATION —
 *
 *       if (app.surname || app.firstName)
 *           return `${app.surname} ${app.firstName}`.trim();
 *
 *   — while the search resolved the query against the USERS collection alone
 *   and then fetched applications by `userId in (...)`. Those are two different
 *   records with two different names. An applicant enters her full legal name
 *   on the form; her account may have been created earlier with a shorter name,
 *   a maiden name, a different spelling, or none of the three fields the user
 *   search reads.
 *
 *   So the admin read a name off the row in front of her, typed it into the box
 *   above it, and was told there was no such person — WHILE LOOKING AT HER.
 *
 *   Worse, the caller's early return made it final:
 *
 *       if (matchingUserIds.length === 0) return { data: [] }
 *
 *   No user matched, so the applications were never queried at all.
 *
 * ── AND WHY IT IS TOKENISED ─────────────────────────────────────────────────
 *
 *   These are PREFIX queries: `>= value` and `< prefixUpperBound(value)`. A
 *   prefix of the whole query only ever matches a field that STARTS with it, so
 *   with "AISHAT Yahaya ABUBAKAR" stored across three fields:
 *
 *       searching "Abubakar"                 matched nothing before
 *       searching "AISHAT Yahaya ABUBAKAR"   matched nothing before
 *
 *   Each token is therefore tried against each field as well as the whole
 *   string. A surname alone finds her; so does her full name; so does the
 *   middle name nobody searches by.
 *
 * @param collection the collection to search
 * @param fields     that collection's own name fields, e.g. surname/firstName
 * @param searchQuery what the admin typed
 * @returns matching DOCUMENT ids, capped like the user search
 */
/**
 * The exclusive upper bound that makes `>= prefix` a PREFIX match.
 *
 *   #814(b) THE U+F8FF TRICK IS COLLATION-DEPENDENT, AND CI PROVED IT.
 *
 *   The first version of the search below bounded its range the way the user
 *   search above still does:
 *
 *       .where(field, "<=", value + "")
 *
 *   It passed locally and FAILED IN CI on exactly the two partial-name cases —
 *   "Abuba" and "AISH" — while every whole-name case passed on both machines.
 *
 *   WHAT IS MEASURED, AND WHAT IS NOT. The obvious explanation is collation:
 *   U+F8FF is a PRIVATE-USE code point, and a locale-aware collation can treat
 *   an unassigned one as ignorable, which would collapse "ABUBA" to
 *   "ABUBA" and make `"ABUBAKAR" <= "ABUBA"` false.
 *
 *   THAT WAS TESTED AND IT IS NOT WHAT HAPPENED HERE. Run against this
 *   project's own Postgres:
 *
 *       collation        >= 'ABUBA'   <= 'ABUBA'||U+F8FF   < 'ABUBB'
 *       C                    t               t                t
 *       en-US-x-icu          t               t                t
 *
 *   So the comparison itself is sound under both. The difference between the
 *   two machines is therefore NOT proven, and is not claimed here.
 *
 *   WHAT IS CERTAIN is narrower and still enough. These filters do not reach
 *   the database as SQL — they go through PostgREST as a URL query string, so
 *   the old bound required a private-use character to survive percent-encoding
 *   and transport intact, across whatever supabase/PostgREST versions the two
 *   environments happen to run. The new bound is pure ASCII drawn from the
 *   alphabet already in the data: "ABUBA" bounds at "ABUBB", and the two
 *   strings differ at a plain letter.
 *
 *   Removing an exotic character from a query string is defensible on its own
 *   terms, whatever the CI database turns out to have been doing. A cause I
 *   cannot demonstrate is not written down as though I could.
 *
 *   The five existing uses in searchUserIdsByQuery are deliberately left alone:
 *   changing a search that is working in production, on the strength of a
 *   defect proved only here, is the wider blast radius. They are recorded as
 *   carrying the same latent fragility.
 */
export function prefixUpperBound(prefix: string): string {
    if (!prefix) return prefix;
    const last = prefix.charCodeAt(prefix.length - 1);
    //   An unpaired surrogate or the top of the plane cannot be incremented
    //   safely; append instead, which is never wrong — only wider.
    if (last >= 0xd7ff) return prefix + "￿";
    return prefix.slice(0, -1) + String.fromCharCode(last + 1);
}

export async function searchDocIdsByNameFields(
    collection: string,
    fields: readonly string[],
    searchQuery: string,
): Promise<string[]> {
    if (!searchQuery?.trim() || fields.length === 0) return [];

    const raw = searchQuery.trim();
    //   The whole string first, then its tokens. Three tokens is enough for
    //   "first middle last" and keeps the query count bounded.
    const terms = [raw, ...raw.split(/\s+/).filter(Boolean).slice(0, 3)];

    /** Every casing a name is stored in here — the same set the user search uses. */
    const variantsOf = (term: string) => Array.from(new Set([
        term,
        term.toLowerCase(),
        term.toUpperCase(),
        term.charAt(0).toUpperCase() + term.slice(1).toLowerCase(),
    ])).filter(Boolean);

    const values = Array.from(new Set(terms.flatMap(variantsOf)));
    const docIds = new Set<string>();

    try {
        const snaps = await Promise.all(
            fields.flatMap((field) => values.map((value) =>
                db.collection(collection)
                    .where(field, ">=", value)
                    //   The high sentinel that makes this a PREFIX range
                    //   rather than an equality: without it, only a whole
                    //   name would ever match. The partial-prefix case in
                    //   the suite is what holds this to a range.
                    .where(field, "<", prefixUpperBound(value))
                    .limit(SEARCH_RESULT_CAP)
                    .get(),
            )),
        );
        snaps.forEach((snap) => snap.docs.forEach((doc) => docIds.add(doc.id)));
    } catch (err) {
        /*
         *   THROWS, for the reason #786 established: a search that fails and
         *   returns [] is indistinguishable from "no such person", which is the
         *   exact confusion this finding is about. Every caller sits inside a
         *   try/catch that turns this into a visible "search failed".
         */
        logger.error("[searchDocIdsByNameFields] the record search failed", {
            collection,
            reason: err instanceof Error ? err.message : String(err),
        });
        throw new Error("The search could not be completed. Please try again.");
    }

    const all = Array.from(docIds);
    if (all.length > SEARCH_RESULT_CAP) {
        logger.warn(
            `[searchDocIdsByNameFields] "${searchQuery}" matched ${all.length} rows in ${collection}; ` +
            `returning the first ${SEARCH_RESULT_CAP}. The screen shows a partial list.`,
        );
    }
    return all.slice(0, SEARCH_RESULT_CAP);
}
