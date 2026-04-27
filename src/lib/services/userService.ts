import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, type User } from "@/lib/types/firestore";
import { invalidateUserCache } from "@/lib/user-cache";

/**
 * ── DATA CONSISTENCY LAYER ──────────────────────────────────────────────────
 * 
 * This module enforces a Single Source of Truth for all User updates.
 * NO module should ever do `adminDb.collection('users').doc(id).update(...)`
 * directly. All writes must route through `atomicUpdateUser` for safety.
 */

// Define protected fields that should never be mutated via broad updates
const PROTECTED_FIELDS = [
    "uid",
    "id",
    "createdAt",
    // We shouldn't manipulate financial fields via generic user updates
    "walletBalance", 
    "totalSavings"
];

/**
 * Perform deep validation on an aggregated User object BEFORE it's committed.
 * This guarantees the Anti-Corruption rules across the Firebase database.
 */
function validateUserState(user: any) {
    // Safely get roles as an array (handle FieldValue.arrayUnion which is an object, not an array)
    const roles = Array.isArray(user.roles) ? user.roles : [];

    // 1. Role / Verification integrity check
    if (roles.includes("seller") && user.sellerVerificationStatus !== "approved" && user.isVerified !== true) {
        throw new Error("Data Integrity Error: Cannot assign 'seller' role without 'approved' verification status.");
    }
    
    // 2. Cooperative integrity check
    if (roles.includes("farmer") && !user.cooperativeMembershipId && user.cooperativeTier === undefined) {
         throw new Error("Data Integrity Error: Farmer role assigned but missing Cooperative mapping logic.");
    }
    
    // 3. ID constraints
    if (user.email && typeof user.email !== "string") {
         throw new Error("Data Integrity Error: Email corrupted.");
    }
}

/**
 * Securely and atomically update a user record.
 * Rolls back automatically if runtime throws an error or validation fails.
 * 
 * @param userId - the document ID (`uid`) of the user
 * @param updates - the fields to update
 */
export async function atomicUpdateUser(userId: string, updates: Record<string, any>): Promise<User> {
    const db = getAdminDb();
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

    // Block protected fields from unauthorized modification
    for (const field of PROTECTED_FIELDS) {
        if (field in updates) {
            throw new Error(`Security Violation: Cannot arbitrarily modify protected field: ${field}`);
        }
    }

    const updatedDocument = await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);

        if (!userDoc.exists) {
            throw new Error(`Data Sync Error: Target user record (${userId}) not found in database.`);
        }

        const currentData = userDoc.data() as User;
        
        // Construct the theoretical updated document
        const newData = {
            ...currentData,
            ...updates,
            updatedAt: new Date()
        };

        // Enforce global platform validation rules
        validateUserState(newData);

        // Commit transaction
        transaction.update(userRef, {
            ...updates,
            updatedAt: newData.updatedAt
        });

        return newData;
    });

    // Invalidate high-performance caching instantly
    try {
        await invalidateUserCache(userId);
    } catch (e) {
        console.warn(`[atomicUpdateUser] Non-fatal caching warning: ${e}`);
    }

    return updatedDocument;
}
