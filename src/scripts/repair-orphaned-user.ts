/**
 * Repair Script: Create Missing Firestore Profile for Orphaned Auth User
 * 
 * USE CASE: When a user exists in Firebase Auth but has no Firestore document
 * 
 * STEPS:
 * 1. Go to Firebase Console > Authentication
 * 2. Find the user by UID: Rc0mYvgCBCcgCQf0FzfMRC73Mvz1
 * 3. Get their email and displayName
 * 4. Update the values below
 * 5. Run this as a server action or admin script
 */

import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@/lib/types/firestore';
import type { User as FirestoreUser } from '@/lib/types/firestore';

async function repairOrphanedUser() {
    // USER DETAILS FROM FIREBASE AUTH
    const uid = 'Rc0mYvgCBCcgCQf0FzfMRC73Mvz1';
    const email = 'user@example.com'; // REPLACE WITH ACTUAL EMAIL FROM AUTH
    const fullName = 'User Name'; // REPLACE WITH ACTUAL NAME FROM AUTH
    const gender = 'male'; // REPLACE WITH ACTUAL GENDER (or ask user to update in profile)

    // DEFAULT ROLES - adjust based on what the user was trying to register for
    // Check registration logs or ask user what platforms they selected
    const roles = ['general_user']; // Add 'buyer', 'seller', 'wave_participant', etc. as needed

    // Create the missing Firestore profile
    const userProfile: Omit<FirestoreUser, 'createdAt' | 'updatedAt'> = {
        uid,
        fullName,
        email,
        roles,
        verified: true, // Auto-verify
        gender,
    };

    try {
        await db.collection(COLLECTIONS.USERS).doc(uid).set({
            ...userProfile,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        console.log('✅ Successfully created Firestore profile for user:', uid);
        console.log('User can now login and access the platform');
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to create user profile:', error);
        return { success: false, error };
    }
}

// ALTERNATIVE: Quick Firebase Console Fix
// Go to Firestore > users collection > Add document
// Document ID: Rc0mYvgCBCcgCQf0FzfMRC73Mvz1
// Fields:
// - uid: "Rc0mYvgCBCcgCQf0FzfMRC73Mvz1"
// - email: (get from Auth)
// - fullName: (get from Auth)
// - roles: ["general_user"]
// - verified: true
// - gender: "male" or "female"
// - createdAt: (timestamp - now)
// - updatedAt: (timestamp - now)

export { repairOrphanedUser };
