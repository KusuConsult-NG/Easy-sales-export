import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS, type User } from "@/lib/types/firestore";
import { invalidateUserCache } from "@/lib/user-cache";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";

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
function validateUserState(user: any, previous?: any) {
    // Safely get roles as an array (handle FieldValue.arrayUnion which is an object, not an array)
    const roles = Array.isArray(user.roles) ? user.roles : [];
    const previousRoles = Array.isArray(previous?.roles) ? previous.roles : [];

    /**
     * 1. Role / Verification integrity check
     *
     * TWO THINGS WERE WRONG WITH THIS
     * -------------------------------
     * The message says "Cannot ASSIGN 'seller' role without 'approved'
     * verification status". The condition said something weaker and something
     * broader, and both mattered.
     *
     * WEAKER: it also required `user.isVerified !== true`. Registration sets
     * `isVerified: true` on every account it creates — see the userProfile in
     * actions/auth.ts — so that clause was false for essentially every real user
     * and the whole guard never fired. A rule that cannot trigger is not a rule,
     * and this one's docstring claims it "guarantees the Anti-Corruption rules
     * across the Firebase database".
     *
     * BROADER: it ran on the MERGED document, so it judged every update to an
     * EXISTING seller, not the assignment the message describes. That is why the
     * escape hatch was load-bearing: without it, tightening the rule would start
     * throwing on ordinary admin edits to any seller whose status is not
     * "approved" — breaking admin tooling to enforce a rule about something that
     * happened in the past.
     *
     * Now it fires on the transition, which is what it always said it was for:
     * the role is being added by THIS update and the verification is not
     * approved. Updating a seller who is already in that state is left alone —
     * that is a data-repair problem, not something to make unfixable by refusing
     * every write to the record.
     */
    const isBecomingSeller = roles.includes("seller") && !previousRoles.includes("seller");

    if (isBecomingSeller && user.sellerVerificationStatus !== "approved") {
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

    // Normalize updates to prevent schema drift (cooperatives vs cooperative, etc.)
    const normalizedUpdates = normalizeUserUpdate(updates);

    // Block protected fields from unauthorized modification
    for (const field of PROTECTED_FIELDS) {
        if (field in normalizedUpdates) {
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
            ...normalizedUpdates,
            updatedAt: new Date()
        };

        // Enforce global platform validation rules.
        //
        // `currentData` is passed so the rules can tell an ASSIGNMENT from an
        // update to a record that already had the role.
        validateUserState(newData, currentData);

        // Commit transaction
        transaction.update(userRef, {
            ...normalizedUpdates,
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
