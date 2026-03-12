import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({ 
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL, 
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
        })
    });
}
const db = admin.firestore();

async function run() {
    try {
        const snap = await db.collection('payments').orderBy('createdAt', 'desc').limit(2).get();
        console.log(`Found ${snap.size} payments.`);
        snap.docs.forEach(d => console.log(d.id, d.data()));
    } catch(e) {
        console.error("Error:", e);
    }
}
run();
