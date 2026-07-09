import { db } from "./firebase-admin";
import { FieldValue } from "@/lib/firestore-compat";

/**
 * Optimistic Locking Helper
 * 
 * Ensures that an update only proceeds if the version in the database matches
 * the version the client last saw.
 */
export async function withOptimisticLock<T>(
    docRef: any,
    clientVersion: number | undefined,
    updateFn: (transaction: any, currentData: T) => void
) {
    return await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) {
            throw new Error("Document does not exist");
        }

        const data = doc.data() as any;
        const serverVersion = data._version || 0;

        // If clientVersion is provided, check for conflict
        if (clientVersion !== undefined && serverVersion > clientVersion) {
            throw new Error("STALE_DATA: Document has been modified by another process. Please refresh and try again.");
        }

        // Execute the update logic
        updateFn(transaction, data as T);

        // Auto-increment version
        transaction.update(docRef, {
            _version: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
        });
    });
}
