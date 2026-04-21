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
        console.log(`- UserID: ${m.userId}`);
        console.log(`  Name: ${m.fullName || m.firstName + ' ' + m.lastName}`);
        console.log(`  Status: ${m.status}`);
        console.log(`  Imported?: ${m._importSource || 'No'}`);
        console.log(`  Invited via Admin?: ${m.invitedByAdmin ? 'Yes' : 'No'}`);
        console.log(`  Created At: ${m.createdAt ? m.createdAt.toDate().toISOString() : 'Unknown'}`);
    }
}
run();
