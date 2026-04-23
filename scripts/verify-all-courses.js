const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });

const db = getFirestore();

async function run() {
    const snap = await db.collection('academy_courses').get();
    console.log(`Total courses in database: ${snap.size}\n`);
    
    snap.docs.forEach(d => {
        const data = d.data();
        const modules = data.modules || [];
        console.log(`Course: "${data.title}" (ID: ${d.id})`);
        console.log(`  Level: ${data.level}, Status: ${data.status || 'N/A'}`);
        console.log(`  Modules: ${modules.length}`);
        modules.forEach((m, i) => {
            console.log(`    Module ${i+1}: "${m.title}" — ${m.lessons?.length || 0} lessons`);
        });
        console.log('');
    });
}
run().catch(console.error);
