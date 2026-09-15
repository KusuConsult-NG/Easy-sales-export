import "server-only";

/**
 * Polling units for one ward, read on the server.
 *
 *   #792 THE FIELD KNEW TWO WARDS OUT OF 8,780.
 *
 *   #774 removed the "PU 001 … PU 010" placeholder — a number that matches
 *   nothing on a voter's card is not an answer — and left real names for Alausa
 *   and Garki, saying the rest had to be added one verified ward at a time.
 *   scripts/build-polling-units.ts did that: 172,000 units across 8,687 wards,
 *   99% of the register, from INEC's published list.
 *
 *   The hand-written pair are gone, and were not merely incomplete: they held
 *   FOUR units for Alausa where the register has EIGHTY-FOUR, and seven for
 *   Garki against a hundred and sixty-nine. A dropdown offering four of
 *   eighty-four is a claim that those are the choices.
 *
 * ── WHY THIS IS SERVER-SIDE AND ASYNC ───────────────────────────────────────
 *
 *   Five megabytes. #789's 8,780 ward names ship to the browser as a module
 *   because a form needs all of them at once to fill a dropdown; this is twenty
 *   times larger and a form needs ONE WARD'S WORTH. Shipping it would make every
 *   page of the platform slower in order to fix one field.
 *
 *   So the data is sharded by state, each shard is imported only when that state
 *   is asked for, and Node keeps it in module cache afterwards — the second
 *   applicant from Lagos costs nothing. `getPollingUnits` and
 *   `hasVerifiedPollingUnits` in lib/locations are gone with the table they
 *   read; nothing can ask this question synchronously in a browser any more,
 *   and that is deliberate.
 */

import { POLLING_UNIT_SHARDS } from "@/data/polling-units";
import { logger } from "@/lib/logger";

/** Match the way the generator wrote its keys, and the way a form spells them. */
const norm = (s: string): string =>
    String(s ?? "").trim().toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9]/g, "");

/** State names differ only in case and spacing between callers. */
function shardFor(state: string): (() => Promise<{ default: Record<string, string[]> }>) | null {
    const wanted = norm(state);
    for (const [name, load] of Object.entries(POLLING_UNIT_SHARDS)) {
        if (norm(name) === wanted) return load;
    }
    return null;
}

/**
 * The polling units in `ward`, or an empty list when they are not known.
 *
 * EMPTY IS A REAL ANSWER and the form treats it as one: 93 wards have no list,
 * and their applicants type the unit themselves — which is what all of them did
 * before this existed. A ward handed another ward's polling units would be a
 * real-looking wrong answer on a member's record, and worse than the numbered
 * placeholder #774 removed.
 */
export async function pollingUnitsFor(
    state: string,
    lga: string,
    ward: string,
): Promise<string[]> {
    if (!state || !lga || !ward) return [];

    const load = shardFor(state);
    if (!load) return [];

    try {
        const shard = (await load()).default;
        const wanted = `${norm(lga)}|${norm(ward)}`;
        for (const [key, units] of Object.entries(shard)) {
            const [l, w] = key.split("|");
            if (`${norm(l)}|${norm(w)}` === wanted) return [...units];
        }
        return [];
    } catch (error) {
        /*
         *   #786's rule. A shard that fails to load is NOT "this ward has no
         *   polling units" — it is a failure, and the two look identical to the
         *   caller unless one of them is written down. The form still degrades
         *   to a typed answer, which is safe; the log is what makes the
         *   difference visible.
         */
        logger.error("[polling-units] shard failed to load", {
            state,
            reason: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}
