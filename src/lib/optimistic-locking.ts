import { Transaction, DocumentReference, FieldValue } from "firebase-admin/firestore";

/**
 * Perform a versioned update to a document within a transaction.
 * This implements Optimistic Locking to prevent race conditions across 
 * long-lived client-side operations or concurrent background processes.
 * 
 * @param transaction The current Firestore transaction
 * @param ref The document reference to update
 * @param expectedVersion The version the client/caller expects (from their local state)
 * @param data The new data to apply to the document
 * @throws Error if the document version has changed or doesn't exist
 */
export async function versionedUpdate(
  transaction: Transaction,
  ref: DocumentReference,
  expectedVersion: number | undefined,
  data: any
) {
  const snap = await transaction.get(ref);
  if (!snap.exists) {
    throw new Error("Document does not exist");
  }

  const currentData = snap.data()!;
  // Default to 0 if _version doesn't exist yet (for backfill compatibility)
  const currentVersion = currentData._version || 0;

  // If expectedVersion is undefined, we might be initializing the versioning
  // but if it is provided, it must match exactly.
  if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
    throw new Error(`STALE_DATA: Concurrency Conflict (optimistic lock). This record was modified by another process (Version ${currentVersion} != Expected ${expectedVersion}). Please refresh and try again.`);
  }

  transaction.update(ref, {
    ...data,
    _version: currentVersion + 1,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
