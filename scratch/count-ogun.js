const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}
const db = admin.firestore();

async function run() {
    let users = 0;
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(d => {
        const u = d.data();
        const s = u.stateOfOrigin || u.state || (u.address && u.address.state) || '';
        if (s.toLowerCase().includes('ogun')) users++;
    });

    let waveBrief = 0;
    const briefSnap = await db.collection('wave_briefing_registrations').get();
    briefSnap.forEach(d => {
        const s = d.data().state || '';
        if (s.toLowerCase().includes('ogun')) waveBrief++;
    });

    let waveApp = 0;
    const waveSnap = await db.collection('wave_applications').get();
    waveSnap.forEach(d => {
        const s = d.data().state || d.data().residentialState || '';
        if (s.toLowerCase().includes('ogun')) waveApp++;
    });

    console.log(`USERS count for Ogun: ${users}`);
    console.log(`WAVE Briefing count for Ogun: ${waveBrief}`);
    console.log(`WAVE Applications count for Ogun: ${waveApp}`);

    process.exit(0);
}
run().catch(console.error);
