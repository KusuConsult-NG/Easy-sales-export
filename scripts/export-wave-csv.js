/**
 * WAVE Registration Full Export
 * Fetches ALL documents from wave_briefing_registrations and wave_applications
 * using Firebase Admin SDK with proper pagination (no 300-doc cap).
 * 
 * Output: /Users/mac/Easy sales Export/wave_registration_export.csv
 */

const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

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

// ─── Female name heuristics for WAVE Briefing (which doesn't have gender field) ───
const FEMALE_NAME_HINTS = [
    'fatima','fatimat','fatimah','fatiha','fatuma','fatime','fatma',
    'zainab','zanab','zeynab','zainab',
    'aisha','aysha','aisha','aeesha',
    'hauwa','hauwau','hawa','hawwa',
    'halima','halimatu','halimah',
    'maryam','mariya','mary','maria','mariam',
    'nancy','blessing','grace','joy','faith','hope','favour','precious','peace','love','mercy',
    'ngozi','chioma','adaeze','amaka','ogechi','chinelo','ginika','eboh',
    'aminat','aminatu','bilkis','khadija','ramatu','hadiza','hasana',
    'hassana','suwaira','zuwaira','rifkatu','salamatu','sadiya','rabi','rahama',
    'rahmatu','rukaiyat','kubura','falmata','zubaida','malama',
    'comfort','patience','victoria','gloria','christiana','esther','ruth',
    'deborah','miriam','sarah','rebecca','elizabeth','rose','alice','beatrice',
    'oghenesuvwe','gbemisola','toluleke','omotola','toluwanimi','titilayo',
    'yetunde','oluwafunmilayo','kehinde','taiwo','temitope','oluwaseun',
    'adeola','adunola','adenike','adaora','ngozichukwuka','chidinma',
    'blessing','veronica','perpetua','cecilia','josephine','theresa',
    'mariam','marium','naheed','nadia','raziat','raliat','ralia',
    'hassanat','hajiya','hafsah','hafsat','kauthar','kausar',
    'rabiatu','rabiatu','ramata','ramatu','fatou','aminata',
    'sadatu','sadatu','zulaihat','jumai','jummai','binta','binta',
    'rabi','habiba','habibat','bilkisu','bilkis','saadatu','sa\'adatu',
    'firdausi','firdaus','asmau','asma','hindatu','hindatu',
    'uwani','rifka','raliya','raliya','hadizatu','hadijatu',
    'asmau','mairama','malama','malama'
];

const FEMALE_ROLES = new Set(['woman_seeking']);

function isFemaleByName(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return FEMALE_NAME_HINTS.some(hint => lower.includes(hint));
}

// ─── Fetch ALL documents from a collection with pagination ───
async function fetchAllDocs(collectionName) {
    console.log(`\nFetching all documents from [${collectionName}]...`);
    const PAGE_SIZE = 500;
    let allDocs = [];
    let lastDoc = null;
    let page = 0;

    while (true) {
        page++;
        let query = db.collection(collectionName).orderBy('createdAt').limit(PAGE_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        allDocs = allDocs.concat(snapshot.docs);
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        process.stdout.write(`  Page ${page}: fetched ${snapshot.docs.length} docs (total so far: ${allDocs.length})\r`);

        if (snapshot.docs.length < PAGE_SIZE) break; // Last page
    }

    console.log(`  ✅ Total fetched from [${collectionName}]: ${allDocs.length}`);
    return allDocs;
}

// ─── CSV helper ───
function csvCell(val) {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
}

async function main() {
    console.log('='.repeat(60));
    console.log('🌊 WAVE FULL REGISTRATION EXPORT');
    console.log('='.repeat(60));

    // ─── 1. Fetch WAVE Briefing Registrations ───
    const briefingDocs = await fetchAllDocs('wave_briefing_registrations');
    const briefingRecords = [];
    for (const doc of briefingDocs) {
        const d = doc.data();
        briefingRecords.push({
            fullName: (d.fullName || '').trim(),
            email: (d.email || d.userEmail || '').trim(),
            phoneNumber: (d.phoneNumber || d.phone || '').trim(),
            state: (d.state || '').trim(),
            lga: '',
            role: d.role || '',
            source: 'WAVE Briefing',
        });
    }

    // ─── 2. Fetch WAVE Applications (deduplicated) ───
    const appDocs = await fetchAllDocs('wave_applications');
    const appRecords = [];
    const seenEmails = new Set();
    for (const doc of appDocs) {
        const d = doc.data();
        const email = (d.userEmail || d.email || '').toLowerCase().trim();
        if (email && seenEmails.has(email)) continue;
        if (email) seenEmails.add(email);

        const firstName = (d.firstName || '').trim();
        const surname = (d.surname || '').trim();
        const otherNames = (d.otherNames || '').trim();
        const fullName = [firstName, otherNames, surname].filter(Boolean).join(' ').replace(/\s+/g, ' ');

        appRecords.push({
            fullName,
            email: email,
            phoneNumber: (d.phoneNumber || d.phone || '').trim(),
            state: (d.stateOfResidence || '').trim(),
            lga: (d.lgaOfResidence || '').trim(),
            role: 'wave_participant',
            source: 'WAVE Application',
        });
    }

    // ─── 3. Combine and categorize ───
    const allRecords = [...briefingRecords, ...appRecords];
    const femaleRecords = allRecords.filter(r => {
        if (r.source === 'WAVE Application') return true; // Program is women-only
        if (FEMALE_ROLES.has(r.role)) return true;
        if (isFemaleByName(r.fullName)) return true;
        return false;
    });

    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Total raw records:           ${allRecords.length}`);
    console.log(`  WAVE Briefing:             ${briefingRecords.length}`);
    console.log(`  WAVE Applications (dedup): ${appRecords.length}`);
    console.log(`Female records:              ${femaleRecords.length}`);

    // ─── 4. Compute totals ───
    const stateTotals = {};
    for (const r of allRecords) {
        const s = r.state || 'Unknown';
        stateTotals[s] = (stateTotals[s] || 0) + 1;
    }

    const lgaTotals = {};
    for (const r of allRecords) {
        if (r.lga) {
            const key = `${r.state}||${r.lga}`;
            lgaTotals[key] = (lgaTotals[key] || 0) + 1;
        }
    }

    // ─── 5. Build CSVs ───
    
    // File 1: Female Registrants (Raw List)
    const linesFull = [];
    linesFull.push(['Full Name', 'Email', 'Phone Number', 'State', 'LGA', 'Source'].join(','));
    for (const r of femaleRecords) {
        linesFull.push([
            csvCell(r.fullName),
            csvCell(r.email),
            csvCell(r.phoneNumber),
            csvCell(r.state),
            csvCell(r.lga),
            csvCell(r.source),
        ].join(','));
    }

    // File 2: State Summary (all registrations)
    const linesStates = [];
    linesStates.push(['State', 'Total Registrations'].join(','));
    const sortedStates = Object.entries(stateTotals).sort((a, b) => b[1] - a[1]);
    for (const [state, count] of sortedStates) {
        linesStates.push(`${csvCell(state)},${count}`);
    }

    // File 3: LGA Summary
    const linesLGAs = [];
    linesLGAs.push(['State', 'LGA', 'Total Registrations'].join(','));
    const sortedLGAs = Object.entries(lgaTotals)
        .map(([key, count]) => {
            const [state, lga] = key.split('||');
            return { state, lga, count };
        })
        .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
    for (const { state, lga, count } of sortedLGAs) {
        linesLGAs.push(`${csvCell(state)},${csvCell(lga)},${count}`);
    }

    // ─── 6. Write files ───
    const basePath = '/Users/mac/Easy sales Export';
    
    const outFull = path.join(basePath, 'wave_registration_export.csv');
    const outStates = path.join(basePath, 'wave_state_summary.csv');
    const outLGAs = path.join(basePath, 'wave_lga_summary.csv');

    fs.writeFileSync(outFull, linesFull.join('\n'), 'utf8');
    fs.writeFileSync(outStates, linesStates.join('\n'), 'utf8');
    fs.writeFileSync(outLGAs, linesLGAs.join('\n'), 'utf8');

    console.log(`\n✅ CSVs written to: ${basePath}`);
    console.log(`   Female records -> wave_registration_export.csv`);
    console.log(`   States: ${sortedStates.length}`);
    console.log(`   LGAs: ${sortedLGAs.length}`);

    console.log('\n─── TOP 10 STATES ───');
    sortedStates.slice(0, 10).forEach(([s, c]) => console.log(`  ${s}: ${c}`));
    console.log('\n─── TOP 10 LGAs ───');
    sortedLGAs.slice(0, 10).forEach(({ state, lga, count }) => console.log(`  ${state} / ${lga}: ${count}`));

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
