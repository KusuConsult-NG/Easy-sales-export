/**
 * Background Job: Detect and Repair Orphaned Firebase Auth Users
 * 
 * Orphaned users = Users in Firebase Auth but missing Firestore profile
 * This can happen if registration fails between Auth creation and Firestore write
 */

import { adminAuth, db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@/lib/types/firestore';
import type { User as FirestoreUser } from '@/lib/types/firestore';
import { logger } from '@/lib/logger';

interface OrphanedUser {
    uid: string;
    email: string | undefined;
    displayName: string | undefined;
    createdAt: string;
}

/**
 * Scan Firebase Auth for users without Firestore profiles
 */
export async function detectOrphanedUsers(): Promise<OrphanedUser[]> {
    const orphanedUsers: OrphanedUser[] = [];

    try {
        // Get all Auth users
        const listUsersResult = await adminAuth.listUsers(1000); // Max 1000 users

        // Check each user for Firestore profile efficiently in batches of 50
        const chunkSize = 50;
        for (let i = 0; i < listUsersResult.users.length; i += chunkSize) {
            const chunk = listUsersResult.users.slice(i, i + chunkSize);
            const refs = chunk.map(u => db.collection(COLLECTIONS.USERS).doc(u.uid));
            
            // Fetch up to 50 docs in parallel
            const docs = await db.getAll(...refs);
            
            docs.forEach((doc, idx) => {
                const userRecord = chunk[idx];
                if (!doc.exists) {
                    orphanedUsers.push({
                        uid: userRecord.uid,
                        email: userRecord.email,
                        displayName: userRecord.displayName,
                        createdAt: userRecord.metadata.creationTime,
                    });

                    logger.warn('Orphaned user detected', {
                        uid: userRecord.uid,
                        email: userRecord.email,
                    });
                }
            });
        }

        return orphanedUsers;
    } catch (error) {
        logger.error('Failed to detect orphaned users', error);
        throw error;
    }
}

/**
 * Auto-repair a single orphaned user by creating their Firestore profile
 */
export async function repairOrphanedUser(uid: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Get user from Firebase Auth
        const userRecord = await adminAuth.getUser(uid);

        // Check if Firestore profile already exists
        const existingDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
        if (existingDoc.exists) {
            return { success: false, error: 'User already has Firestore profile' };
        }

        // Extract info from Auth record
        const email = userRecord.email || `orphaned-${uid}@temp.local`;
        const fullName = userRecord.displayName || 'User';

        // Infer gender from name (basic heuristic, defaults to male)
        const gender = inferGenderFromName(fullName);

        // Create minimal Firestore profile
        const userProfile: Omit<FirestoreUser, 'createdAt' | 'updatedAt'> = {
            uid,
            fullName,
            email,
            roles: ['general_user'], // Minimal role, user can request more
            verified: true, // Auto-verify
            gender,
        };

        await db.collection(COLLECTIONS.USERS).doc(uid).set({
            ...userProfile,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _repairedAt: FieldValue.serverTimestamp(), // Mark as auto-repaired
            _repairReason: 'orphaned_auth_user',
        }, { merge: true });

        logger.info('Successfully repaired orphaned user', { uid, email });

        return { success: true };
    } catch (error) {
        logger.error('Failed to repair orphaned user', { uid, error });
        return { success: false, error: String(error) };
    }
}

/**
 * Repair ALL orphaned users in batch
 */
export async function repairAllOrphanedUsers(): Promise<{
    total: number;
    repaired: number;
    failed: number;
    errors: Array<{ uid: string; error: string }>;
}> {
    const orphanedUsers = await detectOrphanedUsers();

    const results = {
        total: orphanedUsers.length,
        repaired: 0,
        failed: 0,
        errors: [] as Array<{ uid: string; error: string }>,
    };

    for (const user of orphanedUsers) {
        const result = await repairOrphanedUser(user.uid);

        if (result.success) {
            results.repaired++;
        } else {
            results.failed++;
            results.errors.push({
                uid: user.uid,
                error: result.error || 'Unknown error',
            });
        }
    }

    logger.info('Batch orphaned user repair completed', results);

    return results;
}

/**
 * Basic gender inference from name (fallback heuristic)
 */
function inferGenderFromName(name: string): 'male' | 'female' {
    const lowerName = name.toLowerCase();

    // Common female name patterns/endings
    const femalePatterns = [
        'mary', 'sarah', 'elizabeth', 'grace', 'faith', 'hope',
        'aisha', 'fatima', 'blessing', 'mercy', 'joy', 'peace',
    ];

    const femaleEndings = ['a', 'e', 'ie', 'lyn', 'elle'];

    // Check patterns
    if (femalePatterns.some(pattern => lowerName.includes(pattern))) {
        return 'female';
    }

    // Check endings
    if (femaleEndings.some(ending => lowerName.endsWith(ending))) {
        return 'female';
    }

    // Default to male if uncertain (user can update in profile)
    return 'male';
}
