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
        const snap = await db.collection('audit_logs').limit(100).get();
        const actions = new Set();
        snap.docs.forEach(d => {
            if (d.data().action) actions.add(d.data().action);
        });
        console.log(`Found actions: ${Array.from(actions).join(', ')}`);
    } catch(e) {
        console.error("Error:", e);
    }
}
run();
