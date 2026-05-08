/**
 * sync-service-registrations.js
 * 
 * Synchronizes service registrations in the 'users' collection with data from
 * 'academy_applications' and 'cooperative_members'.
 */

const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
    }),
});

const db = admin.firestore();

async function syncAcademy() {
    console.log('🔄 Syncing Academy Statuses...');
    const academySnap = await db.collection('academy_applications').get();
    console.log(`Found ${academySnap.size} applications.`);

    let synced = 0;
    for (const doc of academySnap.docs) {
        const data = doc.data();
        if (data.userId) {
            const userRef = db.collection('users').doc(data.userId);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                await userRef.update({
                    'serviceRegistrations.academy.status': data.status || 'pending',
                    'serviceRegistrations.academy.applicationId': doc.id,
                    'updatedAt': admin.firestore.FieldValue.serverTimestamp()
                });
                synced++;
            }
        }
    }
    console.log(`Synced ${synced} academy statuses.`);
}

async function syncCooperative() {
    console.log('🔄 Syncing Cooperative Statuses...');
    const coopSnap = await db.collection('cooperative_members').get();
    console.log(`Found ${coopSnap.size} members.`);

    let synced = 0;
    for (const doc of coopSnap.docs) {
        const data = doc.data();
        if (data.userId) {
            const userRef = db.collection('users').doc(data.userId);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                await userRef.update({
                    'serviceRegistrations.cooperative.status': data.membershipStatus || 'active',
                    'serviceRegistrations.cooperative.memberId': doc.id,
                    'updatedAt': admin.firestore.FieldValue.serverTimestamp()
                });
                synced++;
            }
        }
    }
    console.log(`Synced ${synced} cooperative statuses.`);
}

async function main() {
    await syncAcademy();
    await syncCooperative();
    console.log('✅ Service Registration Sync Complete');
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
