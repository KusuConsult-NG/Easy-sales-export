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

        // 2. Phone matches — exact AND prefix (so "0803" finds "08035678901")
        const rawPhone = searchQuery.trim();
        const phonePromises: Promise<FirebaseFirestore.QuerySnapshot>[] = [
            // Exact match on both field names
            db.collection(COLLECTIONS.USERS).where("phone", "==", rawPhone).limit(30).get(),
            db.collection(COLLECTIONS.USERS).where("phoneNumber", "==", rawPhone).limit(30).get(),
            // Prefix range on phone field
            db.collection(COLLECTIONS.USERS)
                .where("phone", ">=", rawPhone)
                .where("phone", "<=", rawPhone + "\uf8ff")
                .limit(30).get(),
            // Prefix range on phoneNumber field
            db.collection(COLLECTIONS.USERS)
                .where("phoneNumber", ">=", rawPhone)
                .where("phoneNumber", "<=", rawPhone + "\uf8ff")
                .limit(30).get(),
        ];
        const phoneSnaps = await Promise.all(phonePromises);
        phoneSnaps.forEach(snap => snap.docs.forEach(doc => userIds.add(doc.id)));

        if (userIds.size >= 30) return Array.from(userIds).slice(0, 30);

        // 3. Name prefix matches (multi-casing variations in parallel)
        const capitalizedQ = searchQuery.trim()
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        const uppercaseQ = searchQuery.trim().toUpperCase();
        const rawQ = searchQuery.trim();

        // Collect all distinct query values
        const searchVariations = Array.from(new Set([
            capitalizedQ,
            q,
            uppercaseQ,
            rawQ
        ])).filter(Boolean);

        const namePromises: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
        for (const val of searchVariations) {
            namePromises.push(
                db.collection(COLLECTIONS.USERS)
                    .where("fullName", ">=", val)
                    .where("fullName", "<=", val + "\uf8ff")
                    .limit(30)
                    .get()
            );
            namePromises.push(
                db.collection(COLLECTIONS.USERS)
                    .where("firstName", ">=", val)
                    .where("firstName", "<=", val + "\uf8ff")
                    .limit(30)
                    .get()
            );
            namePromises.push(
                db.collection(COLLECTIONS.USERS)
                    .where("lastName", ">=", val)
                    .where("lastName", "<=", val + "\uf8ff")
                    .limit(30)
                    .get()
            );
        }

        const nameSnaps = await Promise.all(namePromises);
        nameSnaps.forEach(snap => {
            snap.docs.forEach(doc => userIds.add(doc.id));
        });
    } catch (err) {
        console.error("[searchUserIdsByQuery] Error fetching users:", err);
    }

    return Array.from(userIds).slice(0, 30);
}
