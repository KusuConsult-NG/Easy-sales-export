/**
 * Find duplicate emails in wave_briefing_registrations
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

async function run() {
    const snap = await db.collection('wave_briefing_registrations').get();

    const emailMap = {};
    snap.forEach(doc => {
        const d = doc.data();
        const email = d.email?.toLowerCase().trim();
        if (!email) return;
        if (!emailMap[email]) emailMap[email] = [];
        emailMap[email].push({
            docId: doc.id,
            fullName: d.fullName,
            createdAt: d.createdAt?.toDate?.().toISOString() || 'unknown',
            status: d.status,
        });
    });

    const duplicates = Object.entries(emailMap).filter(([, docs]) => docs.length > 1);

    if (duplicates.length === 0) {
        console.log('✅ No duplicate emails found.');
    } else {
        console.log(`⚠️  Found ${duplicates.length} duplicate email(s):\n`);
        duplicates.forEach(([email, docs]) => {
            console.log(`Email: ${email}`);
            docs.forEach((d, i) => {
                console.log(`  [${i + 1}] docId=${d.docId} | name=${d.fullName} | createdAt=${d.createdAt} | status=${d.status}`);
            });
            console.log();
        });
    }

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
