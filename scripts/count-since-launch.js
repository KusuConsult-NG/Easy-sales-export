/**
 * Count registrations since go-live: Wed 26 Feb 2026 00:00 WAT (= 25 Feb 23:00 UTC)
 * Run from project root: node scripts/count-since-launch.js
 */
'use strict';
const admin = require('firebase-admin');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

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

// Wednesday 26 Feb 2026, 00:00 WAT
const LAUNCH = new Date('2026-02-25T23:00:00.000Z');

/**
 * Count docs where the first timestamp field found is >= LAUNCH.
 * Falls back through common field names.
 */
async function cnt(collection, timestampField = 'createdAt') {
    try {
        const snap = await db.collection(collection)
            .where(timestampField, '>=', admin.firestore.Timestamp.fromDate(LAUNCH))
            .count()
            .get();
        return snap.data().count;
    } catch (e) {
        return `ERR(${e.code || e.message?.slice(0, 40)})`;
    }
}

async function main() {
    console.log('\n📊 Registrations since go-live — Wed 26 Feb 2026 (WAT)\n');
    console.log('─'.repeat(56));

    const [
        users,
        waveApp,
        waveBrief,
        academy,
        coopMem,
        coopOnb,
        exportOnb,
        sellerV,
        farmProp,
    ] = await Promise.all([
        cnt('users'),
        cnt('wave_applications'),
        cnt('wave_briefing_registrations'),
        cnt('ACADEMY_APPLICATIONS'),
        cnt('cooperative_members'),
        cnt('cooperative_onboarding_applications'),
        cnt('export_onboarding_applications'),
        cnt('seller_verifications'),
        cnt('farm_nation_properties'),
    ]);

    const rows = [
        ['🌐 Hub — New user accounts', users],
        ['🌊 WAVE Applications', waveApp],
        ['🎟  WAVE Briefing Registrations', waveBrief],
        ['🎓 Academy Applications', academy],
        ['🤝 Cooperative Members enrolled', coopMem],
        ['📋 Cooperative Onboarding submitted', coopOnb],
        ['📦 Export Onboarding submitted', exportOnb],
        ['🏪 Marketplace Seller Verifications', sellerV],
        ['🌾 Farm Nation Properties Listed', farmProp],
    ];

    rows.forEach(([label, val]) => {
        console.log(`${label.padEnd(44)} ${String(val).padStart(6)}`);
    });

    const numbers = rows.map(r => r[1]).filter(v => typeof v === 'number');
    const total = numbers.reduce((a, b) => a + b, 0);

    console.log('─'.repeat(56));
    console.log(`${'TOTAL (all modules combined)'.padEnd(44)} ${String(total).padStart(6)}`);
    console.log('\n⚠  Hub counts are unique new accounts.');
    console.log('   Other modules may include the same people.\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
