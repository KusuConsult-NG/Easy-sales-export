import type { SupabaseDocumentReference } from "./supabase-db";
import { versionedUpdate } from "@/lib/optimistic-locking";

/**
 * Optimistic Locking Helper
 *
 *   #358 THIS WAS THE EXACT BUG lib/optimistic-locking.ts WAS WRITTEN TO FIX,
 *        STILL SITTING IN THE TREE UNDER THE MORE FINDABLE NAME.
 *
 *        Its header said "Ensures that an update only proceeds if the version
 *        in the database matches the version the client last saw." It did not
 *        ensure that. The body was:
 *
 *            return await db.runTransaction(async (transaction) => {
 *                const doc = await transaction.get(docRef);
 *                const serverVersion = doc.data()._version || 0;
 *                if (clientVersion !== undefined && serverVersion > clientVersion) throw ...;
 *                updateFn(transaction, data);
 *                transaction.update(docRef, { _version: FieldValue.increment(1), ... });
 *            });
 *
 *        `runTransaction` in this codebase is not a database transaction.
 *        supabase-db.ts:2156 constructs a queue, runs the callback and flushes
 *        the writes: no lock, no isolation, no rollback. So two callers read
 *        the SAME `_version`, both passed the comparison, and both wrote — the
 *        second reverting the first from a snapshot taken moments earlier, and
 *        reporting success. That is precisely the failure optimistic locking
 *        exists to prevent.
 *
 *        lib/optimistic-locking.ts already says all of this, in its own header,
 *        about its own former implementation — and it was fixed, onto
 *        claim_versioned_update (migration 020), which does the compare-and-swap
 *        in one conditional UPDATE that locks the row. This file is the second
 *        copy of the same helper and it was left behind.
 *
 *        That is #353(b) and #355's shape — two modules named for one job, the
 *        real one and the imposter — with an extra edge: `data-integrity` is
 *        the name somebody greps for, and actions/orders.ts ALREADY IMPORTS
 *        this one. It calls it nowhere (the #357 shape, an import with no
 *        call), so nothing is currently losing writes. It was one keystroke
 *        away.
 *
 *        FIXED, NOT DELETED, per the standing instruction. The signature is
 *        unchanged, so any caller — including the one that already imports it
 *        — now gets the real CAS. The `transaction` handed to updateFn is a
 *        collector: it captures the patch instead of queueing it onto the
 *        unlocked replay path, and the patch is applied through
 *        versionedUpdate.
 */

/** A `FieldValue` sentinel, recognised the way supabase-db recognises them. */
function isSentinel(value: unknown): boolean {
    return typeof value === "object" && value !== null
        && typeof (value as { _methodName?: unknown })._methodName === "string";
}

/**
 * Run `updateFn` and apply its patch under a real compare-and-swap.
 *
 * @param docRef        The document to update.
 * @param clientVersion The version the caller last saw. `undefined` asserts
 *                      nothing but still takes the lock, matching the previous
 *                      behaviour for records written before versioning existed.
 * @param updateFn      Receives a collector in place of a transaction. Call
 *                      `transaction.update(ref, patch)` on it as before.
 *
 * @throws STALE_DATA when the version moved under the caller.
 * @throws "Document does not exist" when there is no such record.
 *
 * FieldValue sentinels in the patch THROW rather than being written.
 * claim_versioned_update applies the patch as JSONB and does not resolve them,
 * so an increment() or serverTimestamp() here would be stored as a literal
 * sentinel object — the silent-corruption outcome. `_version` and `updatedAt`
 * are set by the SQL function itself and must not be in the patch at all.
 */
export async function withOptimisticLock<T>(
    // Was `any`, which made transaction.get() below resolve to
    // `DocumentSnapshot | QuerySnapshot` — a union with neither .exists nor
    // .data() on it. Naming the type is what lets the compiler check the two
    // lines that follow.
    docRef: SupabaseDocumentReference,
    clientVersion: number | undefined,
    updateFn: (transaction: any, currentData: T) => void
) {
    const doc = await docRef.get();
    if (!doc.exists) {
        throw new Error("Document does not exist");
    }

    const data = doc.data() as any;

    // The collector. updateFn still writes through `transaction.update(...)`,
    // so no call site needs to change — but the patch lands here rather than on
    // the adapter's replay queue.
    let patch: Record<string, unknown> = {};
    const collector = {
        update(_ref: unknown, values: Record<string, unknown>) {
            patch = { ...patch, ...values };
        },
        set(_ref: unknown, values: Record<string, unknown>) {
            patch = { ...patch, ...values };
        },
    };

    updateFn(collector, data as T);

    for (const [key, value] of Object.entries(patch)) {
        if (isSentinel(value)) {
            throw new Error(
                `withOptimisticLock: '${key}' is a FieldValue sentinel. The versioned `
                + `compare-and-swap applies the patch as JSONB and cannot resolve `
                + `sentinels — issue that write separately, after this returns.`,
            );
        }
    }
    // Set by claim_versioned_update itself. Passing them would either fight the
    // function or store a sentinel.
    delete patch._version;
    delete patch.updatedAt;

    await versionedUpdate(undefined as any, docRef as any, clientVersion, patch);
}
