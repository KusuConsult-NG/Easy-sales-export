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

const collections = [
    "export_onboarding_applications",
    "cooperative_onboarding_applications",
    "academy_applications",
    "farmNationProperties"
];

async function checkCounts() {
    for (const col of collections) {
        try {
            const snapshot = await db.collection(col).count().get();
            console.log(`Collection ${col}: count = ${snapshot.data().count}`);
        } catch (e) {
            console.log(`Collection ${col}: Error or not found`);
        }
    }
}

checkCounts().catch(console.error);
