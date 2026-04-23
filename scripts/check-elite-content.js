const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
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
    
    if (modules.length === 0) {
        console.log("NO MODULES FOUND - the modules array is empty!");
        return;
    }
    
    modules.forEach(m => {
        console.log(`Module: "${m.title}" — ${m.lessons?.length} lessons`);
        (m.lessons || []).forEach((l, i) => {
            console.log(`  ${i+1}. "${l.title}"`);
            console.log(`     videoUrl: ${l.videoUrl || 'NONE'}`);
            console.log(`     documentUrl: ${l.documentUrl || 'NONE'}`);
            console.log(`     excelUrl: ${l.excelUrl || 'NONE'}`);
        });
    });
}
run().catch(console.error);
