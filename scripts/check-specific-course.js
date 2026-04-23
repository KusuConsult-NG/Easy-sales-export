const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');
initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });
const db = getFirestore();

async function run() {
    const doc = await db.collection('academy_courses').doc('ZzQP201ask3MK4yVMMUX').get();
    if (doc.exists) {
        console.log("Course exists:", doc.data().title);
        console.log("Modules length:", doc.data().modules ? doc.data().modules.length : 'undefined');
    } else {
        console.log("Course does NOT exist in Firestore!");
    }
}
run().catch(console.error);
