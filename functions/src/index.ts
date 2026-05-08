import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// Initialize Admin SDK if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Self-Healing User Profile Trigger
 * 
 * This function triggers automatically whenever a user is created in Firebase Auth.
 * It ensures that the 'users' Firestore collection stays in 1:1 sync with Auth,
 * preventing the "Ghost Auth" gap (where Auth has 44k users but DB has 36k).
 */
export const onUserCreated = functions.auth.user().onCreate(async (user) => {
    const { uid, email, displayName, photoURL } = user;
    const userRef = db.collection("users").doc(uid);

    try {
        // Check if document already exists (to avoid overwriting if frontend was faster)
        const doc = await userRef.get();
        if (doc.exists) {
            console.log(`[onUserCreated] User ${uid} already has a profile. Skipping.`);
            return null;
        }

        console.log(`[onUserCreated] Creating missing profile for Ghost User: ${uid} (${email})`);

        const newUserProfile = {
            uid,
            email: email || "",
            fullName: displayName || "New Member",
            photoURL: photoURL || null,
            roles: ["user"],
            isVerified: false,
            onboardingCompleted: false,
            serviceRegistrations: {
                platform: {
                    status: "active",
                    joinedAt: admin.firestore.FieldValue.serverTimestamp()
                }
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            _system_sync: "cloud-function-v1"
        };

        await userRef.set(newUserProfile);
        
        console.log(`[onUserCreated] Successfully synced Auth user ${uid} to Firestore.`);
        return { success: true };

    } catch (error) {
        console.error(`[onUserCreated] Error syncing user ${uid}:`, error);
        return null;
    }
});
