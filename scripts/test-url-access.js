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
    const lessons = doc.data().modules[0].lessons;
    
    // Test first video and first document
    const testUrls = [
        { title: lessons[0].title, url: lessons[0].videoUrl, type: 'video' },
        { title: lessons[18].title, url: lessons[18].documentUrl, type: 'doc' },
    ];
    
    for (const t of testUrls) {
        console.log(`\nTesting: ${t.title} (${t.type})`);
        console.log(`URL: ${t.url?.substring(0, 120)}...`);
        try {
            const resp = await fetch(t.url, { method: 'HEAD' });
            console.log(`Status: ${resp.status} ${resp.statusText}`);
            console.log(`Content-Type: ${resp.headers.get('content-type')}`);
            console.log(`Content-Length: ${resp.headers.get('content-length')}`);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        }
    }
}
run().catch(console.error);
