import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Searches the users collection by email, phone, or name prefix.
 * Returns a list of matching user IDs (up to 30, which is the limit for 'in' operator in Firestore).
 */
export async function searchUserIdsByQuery(searchQuery: string): Promise<string[]> {
    if (!searchQuery) return [];
    const q = searchQuery.trim().toLowerCase();
    const userIds = new Set<string>();

    try {
        // 1. Exact email match
        const emailSnap = await db.collection(COLLECTIONS.USERS)
            .where("email", "==", q)
            .limit(30)
            .get();
        emailSnap.docs.forEach(doc => userIds.add(doc.id));

        if (userIds.size >= 30) return Array.from(userIds).slice(0, 30);

        // 2. Exact phone matches
        const phoneSnap = await db.collection(COLLECTIONS.USERS)
            .where("phone", "==", searchQuery.trim())
            .limit(30)
            .get();
        phoneSnap.docs.forEach(doc => userIds.add(doc.id));

        if (userIds.size >= 30) return Array.from(userIds).slice(0, 30);

        const phoneNumberSnap = await db.collection(COLLECTIONS.USERS)
            .where("phoneNumber", "==", searchQuery.trim())
            .limit(30)
            .get();
        phoneNumberSnap.docs.forEach(doc => userIds.add(doc.id));

        if (userIds.size >= 30) return Array.from(userIds).slice(0, 30);

        // 3. Name prefix matches (try capitalized first letters since name fields are capitalized in Firestore)
        const capitalizedQ = searchQuery.trim()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');

        const nameSnap = await db.collection(COLLECTIONS.USERS)
            .where("fullName", ">=", capitalizedQ)
            .where("fullName", "<=", capitalizedQ + "\uf8ff")
            .limit(30)
            .get();
        nameSnap.docs.forEach(doc => userIds.add(doc.id));

        if (userIds.size >= 30) return Array.from(userIds).slice(0, 30);

        const firstNameSnap = await db.collection(COLLECTIONS.USERS)
            .where("firstName", ">=", capitalizedQ)
            .where("firstName", "<=", capitalizedQ + "\uf8ff")
            .limit(30)
            .get();
        firstNameSnap.docs.forEach(doc => userIds.add(doc.id));
    } catch (err) {
        console.error("[searchUserIdsByQuery] Error fetching users:", err);
    }

    return Array.from(userIds).slice(0, 30);
}
