import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { getAdminDb, getAdminAuth } from '../src/lib/firebase-admin';

const TARGET_EMAIL = 'hackkusu@gmail.com';

async function clearAuthAndRegistrations() {
    console.log('--- STARTING CLEANUP ---');
    try {
        const db = getAdminDb();
        const auth = getAdminAuth();

        // 1. Clear Briefing Registrations
        console.log('\\n1. Clearing wave_briefing_registrations...');
        const snapshot = await db.collection('wave_briefing_registrations').get();

        if (snapshot.empty) {
            console.log(' - No registrations found.');
        } else {
            const batch = db.batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            console.log(` - Deleted \${snapshot.size} registration(s).`);
        }

        // 2. Delete User from Firestore `users` collection
        console.log(`\\n2. Checking Firestore users for \${TARGET_EMAIL}...`);
        const usersSnapshot = await db.collection('users').where('email', '==', TARGET_EMAIL).get();
        if (usersSnapshot.empty) {
            console.log(` - No user found in Firestore with email \${TARGET_EMAIL}.`);
        } else {
            const batch = db.batch();
            usersSnapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
                console.log(` - Added Firestore user doc \${doc.id} to deletion batch.`);
            });
            await batch.commit();
            console.log(' - Deleted user(s) from Firestore.');
        }

        // 3. Delete User from Firebase Auth
        console.log(`\\n3. Checking Firebase Auth for \${TARGET_EMAIL}...`);
        try {
            const userRecord = await auth.getUserByEmail(TARGET_EMAIL);
            await auth.deleteUser(userRecord.uid);
            console.log(` - Successfully deleted user \${userRecord.uid} from Firebase Auth.`);
        } catch (error: any) {
            if (error.code === 'auth/user-not-found') {
                console.log(` - User \${TARGET_EMAIL} not found in Firebase Auth.`);
            } else {
                console.error(' - Error checking/deleting Firebase Auth user:', error);
            }
        }
    } catch (err) {
        console.error("Critical error:", err);
    }

    console.log('\\n--- CLEANUP COMPLETE ---');
}

clearAuthAndRegistrations().catch(console.error).finally(() => process.exit(0));
