import "server-only";

import { FieldPath } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * Applications whose member account is not there.
 *
 *   #772 "Orphaned Apps: 3" WAS A SAMPLE OF ONE MODULE, RENDERED AS A COUNT.
 *
 *   The owner asked what the System Health tile means. Reading the check it
 *   comes from — health.ts, under its own comment `// 5. Orphaned Apps Check
 *   (Sample)`:
 *
 *       const waveSnap = await db.collection(WAVE_APPLICATIONS).limit(50).get();
 *       …for each: no userId, or the user document is missing → orphaned
 *
 *   Two things were wrong with the number, and they are this audit's two
 *   commonest failures arriving together.
 *
 *   (1) A BOUNDED SCAN PRESENTED AS A MEASUREMENT. Fifty rows, no ordering,
 *       and the tile prints the result as a bare "3" under the heading
 *       "Orphaned Apps". So "3" means "3 of the first 50 rows the database
 *       happened to return" and the platform figure is unknown. #516 removed
 *       the same shape from getFinancialOverview — "reporting the size of one
 *       page as the platform's lifetime total" — and #753 closed a ledger of
 *       sixteen more. The screen now says what it checked.
 *
 *   (2) A LABEL NAMING A CLASS, A CHECK COVERING A QUARTER OF IT. The tile
 *       says "Orphaned Apps"; the query read WAVE and nothing else. Academy,
 *       Export and Farm Nation applications all carry the same `userId` and
 *       all four approval paths read it to grant a role — so an orphan in any
 *       of them is an application no admin can action, and three of the four
 *       were never looked at.
 *
 * ── WHY THIS COSTS LESS THAN THE VERSION THAT CHECKED ONE MODULE ────────────
 *
 *   The old check did one `.doc(userId).get()` PER APPLICATION — up to fifty
 *   round trips on a page an administrator opens BECAUSE something is wrong.
 *   The ids are collected and resolved together here, `documentId() in (…)`
 *   chunked, so four modules at fifty rows each is about seven queries rather
 *   than two hundred. Covering four times as much is cheaper than covering one.
 *
 * ── WHAT COUNTS AS ORPHANED ─────────────────────────────────────────────────
 *
 *   Both shapes the old check counted, kept deliberately:
 *
 *     no userId at all      nothing links the application to an account
 *     userId with no user   the account it names is gone
 *
 *   Neither can be approved: every one of the four approval paths reads
 *   `userId` to grant the module role and write the registration.
 */

/** The four collections whose rows an admin approves by `userId`. */
export const APPLICATION_COLLECTIONS: ReadonlyArray<{ module: string; collection: string }> = [
    { module: "wave", collection: COLLECTIONS.WAVE_APPLICATIONS },
    { module: "academy", collection: COLLECTIONS.ACADEMY_APPLICATIONS },
    { module: "export", collection: COLLECTIONS.EXPORT_APPLICATIONS },
    { module: "farm-nation", collection: COLLECTIONS.FARM_NATION_APPLICATIONS },
];

/**
 * How many rows per collection this scan reads.
 *
 * Bounded on purpose — it runs when a page loads. The point of #772 is not to
 * make it unbounded but to stop the bound being invisible: `scanned` is
 * returned and the screen prints it.
 */
export const ORPHAN_SCAN_LIMIT = 50;

/** The `in` operator is bounded; this codebase's other callers chunk at 30. */
const LOOKUP_CHUNK = 30;

export interface OrphanScan {
    /** Applications with no resolvable member account, across every module. */
    orphaned: number;
    /** How many application rows were actually read. */
    scanned: number;
    /** True when any collection hit ORPHAN_SCAN_LIMIT, so `orphaned` is a floor. */
    bounded: boolean;
    /** Per module, for an operator who has to go and look. */
    byModule: Record<string, number>;
    /** Modules whose read failed; their rows are in neither count. */
    unreadable: string[];
}

interface MinimalDb {
    collection: (name: string) => any;
}

/**
 * Count applications whose member account cannot be resolved.
 *
 * Never throws: a collection that cannot be read is NAMED in `unreadable` and
 * left out of both counts, so a failed read is not reported as "no orphans" —
 * #516's rule, on a figure an operator acts on.
 */
export async function scanOrphanedApplications(
    db: MinimalDb,
    limit: number = ORPHAN_SCAN_LIMIT,
): Promise<OrphanScan> {
    const byModule: Record<string, number> = {};
    const unreadable: string[] = [];
    let scanned = 0;
    let bounded = false;

    /** module → the userIds its rows point at (absent ids counted immediately). */
    const wanted = new Map<string, string[]>();

    for (const { module, collection } of APPLICATION_COLLECTIONS) {
        byModule[module] = 0;
        try {
            const snap = await db.collection(collection).limit(limit).get();
            const docs = snap?.docs ?? [];
            scanned += docs.length;
            if (docs.length >= limit) bounded = true;

            const ids: string[] = [];
            for (const doc of docs) {
                const userId = doc.data()?.userId;
                if (typeof userId !== "string" || userId.trim() === "") {
                    //   Nothing links this application to an account at all.
                    byModule[module] += 1;
                    continue;
                }
                ids.push(userId);
            }
            wanted.set(module, ids);
        } catch (error) {
            //   NAMED, not swallowed into a zero.
            unreadable.push(module);
            logger.error(`[orphaned-applications] could not read ${collection}`, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    //   One batched existence check for every id across every module.
    const allIds = [...new Set([...wanted.values()].flat())];
    const present = new Set<string>();

    for (let i = 0; i < allIds.length; i += LOOKUP_CHUNK) {
        const chunk = allIds.slice(i, i + LOOKUP_CHUNK);
        try {
            const snap = await db.collection(COLLECTIONS.USERS)
                .where(FieldPath.documentId(), "in", chunk)
                .get();
            for (const doc of snap?.docs ?? []) present.add(doc.id);
        } catch (error) {
            /*
             *   A FAILED LOOKUP MUST NOT INVENT ORPHANS. Treating an
             *   unanswered chunk as "these accounts are missing" would report
             *   a database wobble as members who have vanished — the loudest
             *   possible false alarm on this screen. The ids are assumed
             *   present and the failure is named.
             */
            for (const id of chunk) present.add(id);
            if (!unreadable.includes("users")) unreadable.push("users");
            logger.error("[orphaned-applications] user existence lookup failed; assuming present", {
                chunk: chunk.length,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    for (const [module, ids] of wanted) {
        for (const id of ids) if (!present.has(id)) byModule[module] += 1;
    }

    return {
        orphaned: Object.values(byModule).reduce((a, b) => a + b, 0),
        scanned,
        bounded,
        byModule,
        unreadable,
    };
}
