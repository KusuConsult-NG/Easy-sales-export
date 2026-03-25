/**
 * WAVE Duplicate Analysis Script
 * Identifies duplicate submissions in wave_applications
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
            privateKey: privateKey,
        }),
    });
}

const db = admin.firestore();

async function fetchAllDocs(collectionName) {
    const PAGE_SIZE = 500;
    let allDocs = [];
    let lastDoc = null;
    let page = 0;
    while (true) {
        page++;
        let query = db.collection(collectionName).orderBy('createdAt').limit(PAGE_SIZE);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snapshot = await query.get();
        if (snapshot.empty) break;
        allDocs = allDocs.concat(snapshot.docs);
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        process.stdout.write(`  Page ${page}: ${allDocs.length} docs fetched\r`);
        if (snapshot.docs.length < PAGE_SIZE) break;
    }
    console.log(`  ✅ Total: ${allDocs.length}`);
    return allDocs;
}

async function main() {
    console.log('🔍 WAVE Duplicate Analysis\n');

    // ─── Applications ───
    console.log('Fetching wave_applications...');
    const appDocs = await fetchAllDocs('wave_applications');

    const emailMap = {};
    const phoneMap = {};
    const ninMap = {};

    for (const doc of appDocs) {
        const d = doc.data();
        const email = (d.userEmail || d.email || '').toLowerCase().trim();
        const phone = (d.phone || '').replace(/\s+/g, '').trim();
        const nin   = (d.nin || '').trim();
        const name  = `${d.firstName || ''} ${d.surname || ''}`.trim();
        const state = d.stateOfResidence || '';
        const ts    = d.createdAt?.toDate?.() ?? null;

        if (email) {
            if (!emailMap[email]) emailMap[email] = [];
            emailMap[email].push({ id: doc.id, name, state, ts });
        }
        if (phone) {
            if (!phoneMap[phone]) phoneMap[phone] = [];
            phoneMap[phone].push({ id: doc.id, name, state, ts });
        }
        if (nin && nin.length >= 10) {
            if (!ninMap[nin]) ninMap[nin] = [];
            ninMap[nin].push({ id: doc.id, name, state, ts });
        }
    }

    const emailDups = Object.values(emailMap).filter(v => v.length > 1);
    const phoneDups = Object.values(phoneMap).filter(v => v.length > 1);
    const ninDups   = Object.values(ninMap).filter(v => v.length > 1);

    const dupDocCount = emailDups.reduce((sum, arr) => sum + arr.length - 1, 0); // extra copies beyond first

    console.log('\n════════════════════════════════════');
    console.log(' WAVE APPLICATIONS DUPLICATE REPORT');
    console.log('════════════════════════════════════');
    console.log(`Total documents in Firestore:      ${appDocs.length}`);
    console.log(`Unique emails:                     ${Object.keys(emailMap).length}`);
    console.log(`Unique phone numbers:              ${Object.keys(phoneMap).length}`);
    console.log(`Unique NINs:                       ${Object.keys(ninMap).length}`);
    console.log('');
    console.log(`Emails with duplicates:            ${emailDups.length}`);
    console.log(`Phones with duplicates:            ${phoneDups.length}`);
    console.log(`NINs with duplicates:              ${ninDups.length}`);
    console.log(`Extra/duplicate application docs:  ${dupDocCount}`);
    console.log(`Unique applicants (by email):      ${Object.keys(emailMap).length}`);

    // Show top offenders
    const topByEmail = emailDups.sort((a, b) => b.length - a.length).slice(0, 10);
    console.log('\n── Top 10 Email Duplicates ──');
    for (const arr of topByEmail) {
        const first = arr[0];
        const ts0 = first.ts ? first.ts.toISOString().split('T') : ['?','?'];
        const tslast = arr[arr.length-1].ts ? arr[arr.length-1].ts.toISOString().split('T') : ['?','?'];
        const spanMs = first.ts && arr[arr.length-1].ts
            ? arr[arr.length-1].ts - first.ts
            : null;
        const spanSec = spanMs !== null ? (spanMs / 1000).toFixed(1) : '?';
        console.log(`  ${first.name} (${first.state}): ${arr.length} submissions, span=${spanSec}s`);
    }

    // Breakdown by submission count
    const countBuckets = {};
    for (const arr of Object.values(emailMap)) {
        const n = arr.length;
        countBuckets[n] = (countBuckets[n] || 0) + 1;
    }
    console.log('\n── Submissions per Applicant (by email) ──');
    for (const [count, people] of Object.entries(countBuckets).sort((a,b)=>Number(a[0])-Number(b[0]))) {
        console.log(`  ${count} submission(s): ${people} applicant(s)`);
    }

    // ─── Briefing ───
    console.log('\n\nFetching wave_briefing_registrations...');
    const briefDocs = await fetchAllDocs('wave_briefing_registrations');
    const briefEmailMap = {};
    for (const doc of briefDocs) {
        const d = doc.data();
        const email = (d.email || '').toLowerCase().trim();
        if (email) {
            if (!briefEmailMap[email]) briefEmailMap[email] = [];
            briefEmailMap[email].push(doc.id);
        }
    }
    const briefDups = Object.values(briefEmailMap).filter(v => v.length > 1);

    console.log('\n════════════════════════════════════════');
    console.log(' WAVE BRIEFING REGISTRATIONS DUPLICATES');
    console.log('════════════════════════════════════════');
    console.log(`Total documents:     ${briefDocs.length}`);
    console.log(`Unique emails:       ${Object.keys(briefEmailMap).length}`);
    console.log(`Emails with dups:    ${briefDups.length}`);
    console.log(`Extra duplicate docs:${briefDups.reduce((s, a) => s + a.length - 1, 0)}`);

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
