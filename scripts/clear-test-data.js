import admin from 'firebase-admin';
import fs from 'fs';

// Initialize Firebase
const serviceAccount = JSON.parse(fs.readFileSync('./service-account.json', 'utf8'));
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();
const auth = admin.auth();

const TARGET_EMAIL = 'kusuconsult@gmail.com';

async function clearAuthAndRegistrations() {
    console.log('--- STARTING CLEANUP ---');

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
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            console.log(` - User \${TARGET_EMAIL} not found in Firebase Auth.`);
        } else {
            console.error(' - Error checking/deleting Firebase Auth user:', error);
        }
    }

    console.log('\\n--- CLEANUP COMPLETE ---');
}

clearAuthAndRegistrations().catch(console.error).finally(() => process.exit(0));
