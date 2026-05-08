/**
 * verify-relationships.js
 * 
 * Audits relationships between sub-collections and the main users collection.
 * Identifies orphaned records.
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

async function verifyRelationships() {
    console.log('🔍 Auditing Academy Applications...');
    const academySnap = await db.collection('academy_applications').get();
    console.log(`  Found ${academySnap.size} applications.`);

    let orphanedAcademy = 0;
    for (const doc of academySnap.docs) {
        const data = doc.data();
        if (!data.userId) {
            console.warn(`  ⚠️ Application ${doc.id} missing userId`);
            orphanedAcademy++;
            continue;
        }
        const userDoc = await db.collection('users').doc(data.userId).get();
        if (!userDoc.exists) {
            console.warn(`  ❌ Application ${doc.id} has invalid userId: ${data.userId}`);
            orphanedAcademy++;
        }
    }

    console.log('\n🔍 Auditing Cooperative Members...');
    const coopSnap = await db.collection('cooperative_members').get();
    console.log(`  Found ${coopSnap.size} members.`);

    let orphanedCoop = 0;
    for (const doc of coopSnap.docs) {
        const data = doc.data();
        if (!data.userId) {
            console.warn(`  ⚠️ Member ${doc.id} missing userId`);
            orphanedCoop++;
            continue;
        }
        const userDoc = await db.collection('users').doc(data.userId).get();
        if (!userDoc.exists) {
            console.warn(`  ❌ Member ${doc.id} has invalid userId: ${data.userId}`);
            orphanedCoop++;
        }
    }

    console.log('\n--- Relationship Audit Summary ---');
    console.log(`Orphaned Academy Applications: ${orphanedAcademy}`);
    console.log(`Orphaned Cooperative Members: ${orphanedCoop}`);
}

verifyRelationships().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
