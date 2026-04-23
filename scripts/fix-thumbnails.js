const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });

const db = getFirestore();

async function run() {
    const snap = await db.collection('academy_courses').get();
    for (const d of snap.docs) {
        await db.collection('academy_courses').doc(d.id).update({
            thumbnail: '',
            updatedAt: FieldValue.serverTimestamp()
        });
    }
    console.log("Cleared invalid thumbnail paths from all 3 courses. Fallback icon will show instead.");
}
run().catch(console.error);
