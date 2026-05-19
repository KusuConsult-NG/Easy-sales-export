const admin = require('firebase-admin');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

// Parse private key handling escaped newlines
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }
    if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }
}

if (!admin.apps.length) {
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey,
            })
        });
    } else {
        console.warn("Warning: Missing some FIREBASE_ environment variables in .env.local. Falling back to default application credentials.");
        admin.initializeApp();
    }
}

const db = admin.firestore();

async function deleteCollection(db, collectionPath, batchSize) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db, query, resolve) {
    const snapshot = await query.get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
        // When there are no documents left, we are done
        resolve();
        return;
    }

    // Delete documents in a batch
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    
    console.log(`Deleted a batch of ${batchSize} documents.`);

    // Recurse on the next process tick, to avoid
    // exploding the stack.
    process.nextTick(() => {
        deleteQueryBatch(db, query, resolve);
    });
}

async function main() {
    console.log('Starting drop of legacy collection: farmNationProperties');
    
    try {
        await deleteCollection(db, 'farmNationProperties', 100);
        console.log('Successfully dropped legacy collection: farmNationProperties');
    } catch (error) {
        console.error('Error dropping collection:', error);
    }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));
