import * as admin from 'firebase-admin';
import path from 'path';

// Manual initialization so we don't rely on Next.js auth env vars
const serviceAccountPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
let db: admin.firestore.Firestore;

try {
    const serviceAccount = require(serviceAccountPath);
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    db = admin.firestore();
} catch (error) {
    console.error("Failed to init Firebase", error);
    process.exit(1);
}

async function testPagination() {
    console.log("Fetching page 1...");
    const query = db.collection("users").orderBy("createdAt", "desc").limit(5);
    const snapshot = await query.get();

    console.log(`Page 1 returned ${snapshot.docs.length} docs.`);
    snapshot.docs.forEach((doc, i) => {
        console.log(`[${i}] ${doc.id} - ${doc.data().email} - ${doc.data().createdAt?.toDate()}`);
    });

    if (snapshot.docs.length > 0) {
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        console.log(`\nLast doc ID: ${lastDoc.id}`);

        console.log("\nFetching page 2 using startAfter(lastDocSnapshot)...");
        const query2 = db.collection("users").orderBy("createdAt", "desc").startAfter(lastDoc).limit(5);
        const snapshot2 = await query2.get();

        console.log(`Page 2 returned ${snapshot2.docs.length} docs.`);
        snapshot2.docs.forEach((doc, i) => {
            console.log(`[${i}] ${doc.id} - ${doc.data().email} - ${doc.data().createdAt?.toDate()}`);
        });
    }
}

testPagination().catch(console.error);
