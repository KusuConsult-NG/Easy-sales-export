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
