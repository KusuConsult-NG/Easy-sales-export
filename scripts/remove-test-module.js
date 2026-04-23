const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });

const db = getFirestore();

async function run() {
    await db.collection('academy_courses').doc('5s1LUqnXM1N81ad2Bb18').update({ modules: [] });
    console.log("Cleared test module from 5s1LUqnXM1N81ad2Bb18");
}
run().catch(console.error);
