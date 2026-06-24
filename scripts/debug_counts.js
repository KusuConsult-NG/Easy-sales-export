const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

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
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const db = admin.firestore();

async function main() {
    // Let's count how many documents are returned by a query with .where("roles", "array-contains", "cooperative_member")
    const queryCount = await db.collection("users").where("roles", "array-contains", "cooperative_member").count().get();
    console.log(`1. Query count (.where roles array-contains cooperative_member): ${queryCount.data().count}`);

    // Let's count active members in cooperative_members collection
    const activeCount = await db.collection("cooperative_members").where("membershipStatus", "==", "active").count().get();
    const approvedCount = await db.collection("cooperative_members").where("membershipStatus", "==", "approved").count().get();
    console.log(`2. active members count in collection: ${activeCount.data().count}`);
    console.log(`3. approved members count in collection: ${approvedCount.data().count}`);
    console.log(`Total active/approved: ${activeCount.data().count + approvedCount.data().count}`);

    // Let's check if the count matches
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
