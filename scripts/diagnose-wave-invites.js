/**
 * Diagnose: check recent WAVE briefing registrations vs whatsapp_invites
 * Run from project root: node scripts/diagnose-wave-invites.js
 */
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

async function check() {
    console.log('--- Last 10 WAVE Briefing Registrations ---');
    const snap = await db.collection('wave_briefing_registrations')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

    snap.forEach(doc => {
        const d = doc.data();
        const createdAt = d.createdAt?.toDate?.().toISOString() || 'unknown';
        console.log(`\nemail:            ${d.email}`);
        console.log(`name:             ${d.fullName}`);
        console.log(`createdAt:        ${createdAt}`);
        console.log(`confirmationSent: ${d.confirmationSent}`);
    });

    console.log('\n--- WhatsApp Invites (wave_briefing) ---');
    const inviteSnap = await db.collection('whatsapp_invites')
        .where('groupType', '==', 'wave_briefing')
        .get();

    console.log(`Total invite tokens: ${inviteSnap.size}`);
    inviteSnap.forEach(doc => {
        const d = doc.data();
        console.log(` - ${d.email} | used: ${d.used} | created: ${d.createdAt?.toDate?.().toISOString()}`);
    });

    console.log('\n--- ENV CHECK ---');
    console.log('WAVE_WHATSAPP_GROUP_URL set:', !!process.env.WAVE_WHATSAPP_GROUP_URL);
    console.log('RESEND_API_KEY set:', !!process.env.RESEND_API_KEY);

    process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
