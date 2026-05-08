/**
 * cleanup-orphans.js
 * 
 * Deletes orphaned records found in the relationship audit.
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

async function cleanupOrphans() {
    const orphanedAcademyIds = ['0YDfEqYsAyFuKFwPHyzw', 'V0bikXlDoo7OZUk5VlLt'];
    
    console.log('🧹 Cleaning up orphaned Academy Applications...');
    for (const id of orphanedAcademyIds) {
        await db.collection('academy_applications').doc(id).delete();
        console.log(`  Deleted application ${id}`);
    }
    console.log('✅ Orphan cleanup complete');
}

cleanupOrphans().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
