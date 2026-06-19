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

/**
 * Run a Firestore operation with retries on transient connection failures
 */
export async function runQueryWithRetry<T>(queryFn: () => Promise<T>, retries = 3, delay = 500): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await queryFn();
        } catch (err: any) {
            const errMsg = err?.message || String(err);
            const isTransient = errMsg.includes("Premature close") || 
                                errMsg.includes("socket hang up") || 
                                errMsg.includes("ECONNRESET") ||
                                errMsg.includes("Client network socket disconnected") ||
                                errMsg.includes("FetchError") ||
                                errMsg.includes("fetch failed") ||
                                errMsg.includes("Connection closed") ||
                                errMsg.includes("Socket closed") ||
                                errMsg.includes("UNAVAILABLE") ||
                                errMsg.includes("stream terminated") ||
                                errMsg.includes("ERR_STREAM_PREMATURE_CLOSE");
            if (isTransient && i < retries - 1) {
                console.warn(`[Firestore Retry] Transient connection failure: ${errMsg}. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // exponential backoff
                continue;
            }
            throw err;
        }
    }
    return await queryFn();
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

// ─── safeCollection — Proxy-based auto-limit wrapper ──────────────────────────

import type { Firestore } from 'firebase-admin/firestore';

/**
 * safeCollection — A Firestore collection() wrapper that enforces a default
 * document limit on every query chain, preventing accidental unbounded reads.
 *
 * Usage (replaces db.collection('x')):
 *   const q = safeCollection(db, COLLECTIONS.USERS);
 *   const snap = await q.where('status', '==', 'active').get(); // auto-capped at 500
 *
 * To explicitly override the limit (e.g. for broadcast full-scans):
 *   const q = safeCollection(db, COLLECTIONS.USERS, { limit: 0 }); // 0 = no cap
 *   // or: q.limit(5000).get()  ← explicit limit overrides the default
 *
 * HOW IT WORKS:
 * Returns a Proxy around the CollectionReference. The Proxy intercepts .get()
 * and, if no .limit() was previously called in the chain, injects .limit(defaultLimit)
 * before executing the query.
 */
export function safeCollection(
    db: Firestore,
    collectionPath: string,
    options: { limit?: number } = {}
) {
    const defaultLimit = options.limit ?? 500;
    const ref = db.collection(collectionPath);

    // If limit is explicitly 0, return the raw ref (opt-out)
    if (defaultLimit === 0) return ref;

    return createSafeQuery(ref, defaultLimit);
}

function createSafeQuery(
    query: FirebaseFirestore.Query | FirebaseFirestore.CollectionReference,
    defaultLimit: number
): any {
    let hasLimit = false;

    return new Proxy(query, {
        get(target: any, prop: string) {
            if (prop === 'limit') {
                return (...args: any[]) => {
                    hasLimit = true;
                    return createSafeQuery(target.limit(...args), defaultLimit);
                };
            }
            if (
                prop === 'where' || prop === 'orderBy' || prop === 'startAfter' ||
                prop === 'endBefore' || prop === 'startAt' || prop === 'endAt' ||
                prop === 'select' || prop === 'offset'
            ) {
                return (...args: any[]) =>
                    createSafeQuery(target[prop](...args), defaultLimit);
            }
            if (prop === 'get') {
                return async () => {
                    const finalQuery = hasLimit ? target : target.limit(defaultLimit);
                    if (!hasLimit) {
                        // Only warn if genuinely uncapped — this is the whole point
                        const { logger } = await import('./logger');
                        logger.debug(`[safeCollection] auto-applied .limit(${defaultLimit}) — consider adding explicit .limit() to this query`);
                    }
                    return finalQuery.get();
                };
            }
            // stream(), count(), etc. — pass through directly
            const val = target[prop];
            return typeof val === 'function' ? val.bind(target) : val;
        },
    });
}
