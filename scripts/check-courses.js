const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey && privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
}
if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
}

initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    })
});

const db = getFirestore();

async function run() {
    const snap = await db.collection('academy_courses').get();
    snap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`Course ${doc.id}: title="${data.title}", modules count=${data.modules ? data.modules.length : 'undefined'}`);
    });
}
run().catch(console.error);
