const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });

const db = getFirestore();

async function run() {
    const updates = [
        {
            id: 'vCRoG8Z3FabDVfxh0y8L',
            data: { tier: 'foundation', price: 25000, status: 'published' }
        },
        {
            id: 'czrYsOEPzWXcjDpP85RA',
            data: { tier: 'standard', price: 50000, status: 'published' }
        },
        {
            id: '5s1LUqnXM1N81ad2Bb18',
            data: { tier: 'elite', price: 100000, status: 'published' }
        }
    ];

    for (const u of updates) {
        await db.collection('academy_courses').doc(u.id).update({
            ...u.data,
            updatedAt: FieldValue.serverTimestamp()
        });
    }

    // Verify
    const snap = await db.collection('academy_courses').get();
    snap.docs.forEach(d => {
        const data = d.data();
        console.log(`"${data.title}" — tier: ${data.tier}, price: ₦${data.price?.toLocaleString()}, status: ${data.status}`);
    });
}
run().catch(console.error);
