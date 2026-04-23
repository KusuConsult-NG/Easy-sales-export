const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });

const db = getFirestore();

async function run() {
    // Delete the fake course I created
    await db.collection('academy_courses').doc('ZzQP201ask3MK4yVMMUX').delete();
    console.log("Deleted fake Export Masterclass course (ZzQP201ask3MK4yVMMUX)");
    
    // Verify remaining courses
    const snap = await db.collection('academy_courses').get();
    console.log(`\nRemaining courses in database: ${snap.size}`);
    snap.docs.forEach(d => {
        const data = d.data();
        console.log(`  - "${data.title}" (${d.id}) — ${(data.modules || []).length} modules`);
    });
}
run().catch(console.error);
