import { getAdminDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Atomic Write Wrapper (Safe Write)
 * 
 * Ensures every document write includes mandatory createdAt and updatedAt
 * server timestamps to prevent dashboard crashes and cursor pagination errors.
 * 
 * @param collection - Firestore collection name
 * @param data - Document data
 * @param customId - Optional specific document ID
 */
export async function safeWrite(
    collection: string, 
    data: any, 
    customId?: string
) {
    const db = getAdminDb();
    const collectionRef = db.collection(collection);
    
    const payload = {
        ...data,
        createdAt: data.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        _system_safe_write: true
    };

    if (customId) {
        await collectionRef.doc(customId).set(payload, { merge: true });
        return { id: customId };
    } else {
        const docRef = await collectionRef.add(payload);
        return { id: docRef.id };
    }
}

/**
 * Safe Update Wrapper
 * 
 * Automatically updates the updatedAt timestamp.
 */
export async function safeUpdate(
    collection: string,
    docId: string,
    data: any
) {
    const db = getAdminDb();
    const docRef = db.collection(collection).doc(docId);

    await docRef.update({
        ...data,
        updatedAt: FieldValue.serverTimestamp(),
    });

    return { id: docId };
}

// ─── Pagination & Safe Query Helpers ──────────────────────────────────────────

import type { CollectionReference, Query } from 'firebase-admin/firestore';

/**
 * Applies cursor-based pagination to any Firestore query.
 * Uses the same startAfter(docSnapshot) pattern already used throughout the codebase.
 *
 * @param query      - The base query (already has .where() / .orderBy() applied)
 * @param collection - The collection reference to fetch the cursor doc from
 * @param limit      - Max documents to return per page
 * @param lastDocId  - Document ID of the last item from the previous page (cursor)
 * @returns { docs, hasMore, nextCursor }
 */
export async function paginatedQuery(
    query: Query,
    collection: CollectionReference,
    limit: number,
    lastDocId?: string
): Promise<{
    docs: FirebaseFirestore.QueryDocumentSnapshot[];
    hasMore: boolean;
    nextCursor: string | null;
}> {
    let q = query.limit(limit + 1);

    if (lastDocId) {
        const cursorDoc = await collection.doc(lastDocId).get();
        if (cursorDoc.exists) {
            q = q.startAfter(cursorDoc) as Query;
        }
    }

    const snapshot = await q.get();
    const docs = snapshot.docs.slice(0, limit);
    const hasMore = snapshot.docs.length > limit;
    const nextCursor = hasMore ? docs[docs.length - 1]?.id ?? null : null;

    return { docs, hasMore, nextCursor };
}

/**
 * Safe collection query with a mandatory limit cap.
 * Falls back to 500 if no limit is provided.
 */
export function withSafeLimit<T extends Query>(query: T, limit = 500): T {
    return query.limit(limit) as T;
}
