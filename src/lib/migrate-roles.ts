/**
 * Database Migration Utility
 * Migrates users from single role to multi-role array system
 */

import { db } from "./firebase";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { COLLECTIONS, LEGACY_ROLE_MAP, type LegacyRole, type UserRole } from "./types/firestore";

/**
 * Migrate a single user from legacy role to roles array
 */
export async function migrateUserRole(userId: string, legacyRole: LegacyRole): Promise<void> {
    const newRole = LEGACY_ROLE_MAP[legacyRole];
    const userRef = doc(db, COLLECTIONS.USERS, userId);

    await updateDoc(userRef, {
        roles: [newRole], // Convert single role to array
        // Keep legacy role for backward compatibility during transition
        legacyRole: legacyRole,
        updatedAt: new Date(),
    });

    console.log(`Migrated user ${userId}: ${legacyRole} → [${newRole}]`);
}

/**
 * Migrate all users in database
 * WARNING: This should only be run once during deployment
 */
export async function migrateAllUsers(): Promise<{ success: number; failed: number }> {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const snapshot = await getDocs(usersRef);

    let success = 0;
    let failed = 0;

    for (const userDoc of snapshot.docs) {
        try {
            const userData = userDoc.data();

            // Skip if already migrated
            if (userData.roles && Array.isArray(userData.roles)) {
                console.log(`User ${userDoc.id} already migrated, skipping`);
                continue;
            }

            // Get legacy role
            const legacyRole = userData.role as LegacyRole;
            if (!legacyRole || !(legacyRole in LEGACY_ROLE_MAP)) {
                console.warn(`User ${userDoc.id} has invalid role: ${legacyRole}`);
                failed++;
                continue;
            }

            await migrateUserRole(userDoc.id, legacyRole);
            success++;
        } catch (error) {
            console.error(`Failed to migrate user ${userDoc.id}:`, error);
            failed++;
        }
    }

    return { success, failed };
}

/**
 * Check if migration is needed
 */
export async function needsMigration(): Promise<boolean> {
    const usersRef = collection(db, COLLECTIONS.USERS);
    const snapshot = await getDocs(usersRef);

    for (const userDoc of snapshot.docs) {
        const userData = userDoc.data();

        // If any user doesn't have roles array, migration is needed
        if (!userData.roles || !Array.isArray(userData.roles)) {
            return true;
        }
    }

    return false;
}

/**
 * Add role to user
 */
export async function addUserRole(userId: string, role: UserRole): Promise<void> {
    const userRef = doc(db, COLLECTIONS.USERS, userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
        throw new Error("User not found");
    }

    const userData = userDoc.data();
    const currentRoles = userData.roles || [];

    if (currentRoles.includes(role)) {
        console.log(`User ${userId} already has role ${role}`);
        return;
    }

    await updateDoc(userRef, {
        roles: [...currentRoles, role],
        updatedAt: new Date(),
    });

    console.log(`Added role ${role} to user ${userId}`);
}

/**
 * Remove role from user
 */
export async function removeUserRole(userId: string, role: UserRole): Promise<void> {
    const userRef = doc(db, COLLECTIONS.USERS, userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
        throw new Error("User not found");
    }

    const userData = userDoc.data();
    const currentRoles = userData.roles || [];

    await updateDoc(userRef, {
        roles: currentRoles.filter((r: UserRole) => r !== role),
        updatedAt: new Date(),
    });

    console.log(`Removed role ${role} from user ${userId}`);
}

/**
 * Set user roles (replaces all existing roles)
 */
export async function setUserRoles(userId: string, roles: UserRole[]): Promise<void> {
    const userRef = doc(db, COLLECTIONS.USERS, userId);

    await updateDoc(userRef, {
        roles,
        updatedAt: new Date(),
    });

    console.log(`Set roles for user ${userId}:`, roles);
}

import { getDoc } from "firebase/firestore";
