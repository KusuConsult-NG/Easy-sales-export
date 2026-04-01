const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) {
    console.error('Missing Firebase credentials in .env.local');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    }),
});

const db = admin.firestore();
const auth = admin.auth();

async function deleteCollection(collectionPath) {
    const collectionRef = db.collection(collectionPath);
    const batchSize = 100;
    let totalDeleted = 0;

    while (true) {
        const snapshot = await collectionRef.limit(batchSize).get();
        if (snapshot.empty) break;

        const batch = db.batch();
        for (const doc of snapshot.docs) {
            // Delete subcollections
            const subcollections = await doc.ref.listCollections();
            for (const sub of subcollections) {
                await deleteCollection(`${collectionPath}/${doc.id}/${sub.id}`);
            }
            batch.delete(doc.ref);
        }
        await batch.commit();
        totalDeleted += snapshot.size;
    }

    return totalDeleted;
}

async function deleteAllCollections() {
    console.log('\n🗄️  CLEARING ALL FIRESTORE DATA...\n');
    const collections = await db.listCollections();

    if (collections.length === 0) {
        console.log('  No collections found.');
        return;
    }

    for (const collection of collections) {
        const count = await deleteCollection(collection.id);
        console.log(`  ✓ Deleted documents from "${collection.id}"`);
    }
    console.log('\n✅ All Firestore data cleared.');
}

async function deleteAllAuthUsers() {
    console.log('\n🔐 CLEARING ALL AUTH USERS...\n');
    let totalDeleted = 0;

    while (true) {
        const listResult = await auth.listUsers(1000);
        if (listResult.users.length === 0) break;

        const uids = listResult.users.map(u => u.uid);
        const result = await auth.deleteUsers(uids);
        totalDeleted += result.successCount;

        if (result.failureCount > 0) {
            console.log(`  ⚠️  Failed to delete ${result.failureCount} users`);
            result.errors.forEach(e => console.log(`    - ${e.error.message}`));
        }
    }

    console.log(`  ✓ Deleted ${totalDeleted} auth users`);
    console.log('\n✅ All auth users cleared.');
}

async function main() {
    console.log('============================================');
    console.log('  ⚠️  CLEARING ENTIRE DATABASE & AUTH');
    console.log(`  Project: ${process.env.FIREBASE_PROJECT_ID}`);
    console.log('============================================');

    try {
        await deleteAllCollections();
        await deleteAllAuthUsers();

        console.log('\n============================================');
        console.log('  ✅ DATABASE AND AUTH COMPLETELY CLEARED');
        console.log('============================================\n');
    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

main();
