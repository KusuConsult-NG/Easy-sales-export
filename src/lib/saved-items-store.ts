import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isSavedRow, SAVED_ITEMS_PER_USER_CAP, type SavedItemType } from "@/lib/saved-items";

/**
 * Reading one person's saved rows — the single implementation.
 *
 * #105. There are two callers: the actions in app/actions/saved-items.ts, and
 * the buyer dashboard's "Saved Sellers" tile, which needs the count and lives
 * in a different action file. Both go through here rather than each writing
 * their own query, because "which rows count as saved" is exactly the kind of
 * rule this codebase has repeatedly ended up stating twice and differently.
 *
 * It is a plain module, not a "use server" one, so it can be imported from
 * anywhere. A "use server" module may only export async functions, and a
 * shared helper exported from one would become a registered server action
 * reachable over the wire whether or not a screen calls it — #374/#379's
 * lesson.
 */

export interface SavedItemRow {
    targetId: string;
    savedAt: string | null;
}

export function savedItemTimestamp(value: unknown): string | null {
    if (!value) return null;
    const raw = typeof (value as { toDate?: () => Date }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : (value as string | number | Date);
    const d = new Date(raw as string);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Every row this person currently has saved under one item type, newest first.
 *
 * THE QUERY FILTERS ON `userId` AND `itemType` ONLY, AND THE SAVED/UNSAVED
 * SPLIT IS DONE IN CODE. That is deliberate. This adapter stores the document
 * in raw_data JSONB and a `.where()` on it compares as TEXT, so
 * `.where("saved", "==", false)` compares a boolean against a string and its
 * outcome depends on which writer produced the row. A person's saved list is
 * small, SAVED_ITEMS_PER_USER_CAP bounds it, and reading a boolean out of a
 * document this code wrote is exact where the comparison is not.
 *
 * The cap is explicit for the other reason too: a query with no `.limit()`
 * returns at most 5,000 rows from this adapter and says nothing about having
 * stopped, which is how a list silently becomes a partial one.
 */
export async function readSavedRows(
    userId: string,
    itemType: SavedItemType,
): Promise<SavedItemRow[]> {
    const snapshot = await db
        .collection(COLLECTIONS.SAVED_ITEMS)
        .where("userId", "==", userId)
        .where("itemType", "==", itemType)
        .limit(SAVED_ITEMS_PER_USER_CAP)
        .get();

    return snapshot.docs
        .map((doc) => doc.data() as Record<string, unknown>)
        .filter((data) => isSavedRow(data))
        .map((data) => ({
            targetId: String(data.targetId ?? "").trim(),
            savedAt: savedItemTimestamp(data.savedAt),
        }))
        .filter((row) => row.targetId !== "")
        .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
}

/** How many things of one type this person has saved. */
export async function countSavedItems(
    userId: string,
    itemType: SavedItemType,
): Promise<number> {
    const rows = await readSavedRows(userId, itemType);
    return rows.length;
}
