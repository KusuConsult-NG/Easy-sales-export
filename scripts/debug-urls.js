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
    
    // Show first video URL and first PDF URL
    const video = lessons.find(l => l.videoUrl);
    const pdf = lessons.find(l => l.documentUrl);
    
    console.log("VIDEO URL (first 200 chars):");
    console.log(video?.videoUrl?.substring(0, 200));
    console.log("\nURL type:", video?.videoUrl?.includes('storage.googleapis.com/') ? 'SIGNED URL' : 'TOKEN URL');
    
    console.log("\nPDF URL (first 200 chars):");
    console.log(pdf?.documentUrl?.substring(0, 200));
    
    // Test access
    for (const [label, url] of [['Video', video?.videoUrl], ['PDF', pdf?.documentUrl]]) {
        if (!url) continue;
        try {
            const resp = await fetch(url, { method: 'HEAD' });
            console.log(`\n${label} access: ${resp.status} ${resp.statusText}`);
            console.log(`  Content-Type: ${resp.headers.get('content-type')}`);
            console.log(`  Access-Control-Allow-Origin: ${resp.headers.get('access-control-allow-origin')}`);
        } catch (err) {
            console.log(`\n${label} error: ${err.message}`);
        }
    }
}
run().catch(console.error);
