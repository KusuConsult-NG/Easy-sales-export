const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    })
});

const db = admin.firestore();

async function deleteCollection(collectionPath) {
    const collectionRef = db.collection(collectionPath);
    let totalDeleted = 0;

    // Use a simpler query without batchSize limit loop
    // if the collections aren't massive.
    while (true) {
        const snapshot = await collectionRef.limit(100).get();
        if (snapshot.empty) break;

        const batch = db.batch();
        for (const doc of snapshot.docs) {
            batch.delete(doc.ref);
        }
        await batch.commit();
        totalDeleted += snapshot.size;
    }

    return totalDeleted;
}

async function run() {
    console.log('Clearing remaining collections...');
    const collections = await db.listCollections();
    for (const collection of collections) {
         console.log(`Deleting ${collection.id}...`);
         await deleteCollection(collection.id);
         console.log(`Deleted ${collection.id}.`);
    }
    
    console.log('Done.');
    process.exit(0);
}

run();
