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
    console.log("Listing users directly...");
    const snap = await db.collection("users").get();
    console.log(`Found ${snap.size} users:`);
    snap.forEach(doc => {
        const data = doc.data();
        console.log(`- ${doc.id}: ${data.email} (${data.fullName || data.name}) | Roles: ${JSON.stringify(data.roles || [])}`);
    });
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Connection failed:", err);
    process.exit(1);
});
