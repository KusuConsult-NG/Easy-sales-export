const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });

const db = getFirestore();

async function run() {
    const doc = await db.collection('academy_courses').doc('5s1LUqnXM1N81ad2Bb18').get();
    const data = doc.data();
    const modules = data.modules || [];
    
    if (modules.length === 0) return console.log("No modules found");
    
    const mod = modules[0];
    // Remove duplicate by title
    const seen = new Set();
    const deduped = mod.lessons.filter(l => {
        if (seen.has(l.title)) return false;
        seen.add(l.title);
        return true;
    });
    
    // Re-order
    deduped.forEach((l, i) => l.order = i);
    
    mod.lessons = deduped;
    
    await db.collection('academy_courses').doc('5s1LUqnXM1N81ad2Bb18').update({
        modules: [mod],
        updatedAt: FieldValue.serverTimestamp(),
    });
    
    console.log(`Elite module cleaned: ${deduped.length} lessons\n`);
    deduped.forEach((l, i) => console.log(`  ${i + 1}. ${l.title}`));
}
run().catch(console.error);
