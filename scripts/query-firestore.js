require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
    });
}
const db = admin.firestore();

async function check() {
    const p = await db.collection('broadcast_logs').orderBy('sentAt', 'desc').limit(5).get();
    console.log("Found:", p.size);
    p.forEach(doc => {
       console.log(doc.id, doc.data());
    });
}
check().catch(console.error);
