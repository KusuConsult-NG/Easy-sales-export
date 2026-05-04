require("dotenv").config({ path: ".env.local" });
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey && privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
}
if (privateKey && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
}

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const db = getFirestore();

async function checkStatuses() {
    const statuses = ["pending", "under_review", "approved", "rejected", "submitted", "draft"];
    for (const status of statuses) {
        const snapshot = await db.collection('wave_applications').where('status', '==', status).count().get();
        console.log(`Status ${status}: ${snapshot.data().count}`);
    }
}

checkStatuses().catch(console.error);
