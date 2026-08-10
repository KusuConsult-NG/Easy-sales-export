import { Transaction, DocumentReference, getTableName } from "@/lib/supabase-db";
import { claimVersionedUpdate } from "@/lib/wallet-ledger";

/**
 * Perform a versioned update to a document — optimistic locking that locks.
 *
 * WHAT WAS WRONG
 * --------------
 * This read `_version` inside `runTransaction`, compared it, and wrote:
 *
 *     const snap = await transaction.get(ref);
 *     if (currentVersion !== expectedVersion) throw new Error("STALE_DATA...");
 *     transaction.update(ref, { ...data, _version: currentVersion + 1 });
 *
 * `runTransaction` is not a transaction — it runs the callback and replays the
 * queued writes afterwards, with no lock, no isolation and no rollback. So two
 * callers read the SAME version, both passed the comparison, and both wrote.
 * The second silently reverted the first, using a snapshot taken moments
 * earlier, and reported success.
 *
 * That is precisely the failure optimistic locking exists to prevent, which is
 * why `loan-actions.ts` dropped this helper from its approval path rather than
 * trusting it. Every other caller kept it, and kept the false guarantee.
 *
 * THE FIX IS ONE CHANGE, NOT SIX
 * ------------------------------
 * `claim_versioned_update` (migration 020) does the compare-and-swap in a single
 * conditional UPDATE that locks the row and re-reads it under the lock, so
 * exactly one of two concurrent callers wins. Rewriting this function moves
 * every caller onto it — vendor-settings.ts (4 sites), admin.ts, and
 * cooperative/_actions.ts `_updateMembershipAction` — without touching them,
 * the same way `splitIncrements` fixed 142 increment call sites at once.
 *
 * @param transaction Unused. Kept for the call signature — see the note below.
 * @param ref The document to update.
 * @param expectedVersion The version the caller expects. `undefined` asserts
 *   nothing but still takes the lock, matching the previous behaviour for
 *   records written before versioning existed.
 * @param data The patch to apply.
 * @throws STALE_DATA when the version moved, or "Document does not exist".
 */
export async function versionedUpdate(
  transaction: Transaction,
  ref: DocumentReference,
  expectedVersion: number | undefined,
  data: any
) {
  // `transaction` is deliberately unused.
  //
  // It is kept so the six call sites need no edit, and because passing it would
  // be actively wrong: queueing this write into the adapter's transaction would
  // put it back on the unlocked replay path this function exists to leave. The
  // CAS below is applied immediately and atomically instead.
  void transaction;

  // `path` is `${collection}/${id}`. The collection is needed as well as the
  // table, because a document in the generic `document_collections` table is
  // identified by (id, collection_name) rather than by id alone.
  const collection = ref.path.split("/")[0];
  const table = getTableName(collection);

  const result = await claimVersionedUpdate({
    table,
    id: ref.id,
    expectedVersion,
    // updatedAt is set by the SQL function itself (updated_at = NOW()). It is
    // deliberately not in this patch: FieldValue sentinels are NOT resolved by
    // claim_versioned_update — it applies the patch as JSONB — so a
    // serverTimestamp() here would be stored as a literal sentinel object.
    // The same caveat applies to any increment a caller puts in `data`; issue
    // those as a separate update after this returns.
    patch: data,
    collection: table === "document_collections" ? collection : undefined,
  });

  if (result.version === null) {
    // A missing record is a different failure from a lost claim. Reporting it
    // as a conflict would tell the user to refresh and retry a record that does
    // not exist.
    throw new Error("Document does not exist");
  }

  if (!result.claimed) {
    throw new Error(
      `STALE_DATA: Concurrency Conflict (optimistic lock). This record was modified by another process (Version ${result.version} != Expected ${expectedVersion}). Please refresh and try again.`
    );
  }
}
