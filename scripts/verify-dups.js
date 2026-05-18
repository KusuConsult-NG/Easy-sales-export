require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (getApps().length === 0) {
    let key = process.env.FIREBASE_PRIVATE_KEY;
    if (key && key.startsWith('"')) key = key.slice(1, -1);
    if (key) key = key.replace(/\\n/g, '\n');
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: key
        })
    });
}
const db = getFirestore();

async function check() {
    const mem = await db.collection("cooperative_members").get();
    
    const ids = new Set();
    const dups = [];
    mem.docs.forEach(doc => {
        const uid = doc.data().userId || doc.id;
        if (ids.has(uid)) dups.push(uid);
        ids.add(uid);
    });
    
    console.log("Forms: ", mem.size);
    console.log("Unique userIds: ", ids.size);
    console.log("Duplicates: ", dups);
}
check();
