const admin = require('firebase-admin');
const fs = require('fs');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(fs.readFileSync('./firebase-admin-key.json', 'utf8'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function run() {
    const sn = await db.collection('cooperative_members').get();
    const members = [];
    sn.forEach(doc => members.push({ id: doc.id, ...doc.data() }));
    console.log(`Total cooperative members: ${members.length}`);
    
    for (const m of members) {
        console.log(`- ID: ${m.userId}, Status: ${m.status}, Plan: ${m.planId}, Imported: ${m._importSource || 'No'}`);
    }
}
run();
