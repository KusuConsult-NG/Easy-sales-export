/**
 * WAVE Duplicate Cleanup Script
 * 
 * Safe deduplication of wave_applications:
 * - Groups all docs by email
 * - Keeps the OLDEST submission (earliest createdAt)
 * - Deletes all newer duplicates
 * 
 * DRY RUN mode is ON by default. Set DRY_RUN = false to actually delete.
 */

const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const DRY_RUN = false; // ← set to false to actually delete

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
    while (true) {
        let query = db.collection(collectionName).orderBy('createdAt').limit(PAGE_SIZE);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snapshot = await query.get();
        if (snapshot.empty) break;
        allDocs = allDocs.concat(snapshot.docs);
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        process.stdout.write(`  Fetched ${allDocs.length} docs...\r`);
        if (snapshot.docs.length < PAGE_SIZE) break;
    }
    console.log(`  ✅ Total fetched: ${allDocs.length}\n`);
    return allDocs;
}

async function main() {
    console.log('='.repeat(55));
    console.log(`🧹 WAVE APPLICATION DUPLICATE CLEANUP`);
    console.log(`   Mode: ${DRY_RUN ? '🟡 DRY RUN (no deletions)' : '🔴 LIVE (will delete!)'}`);
    console.log('='.repeat(55) + '\n');

    console.log('Fetching wave_applications...');
    const docs = await fetchAllDocs('wave_applications');

    // Group by email
    const emailMap = {};
    for (const doc of docs) {
        const d = doc.data();
        const email = (d.userEmail || d.email || '').toLowerCase().trim();
        if (!email) continue;
        if (!emailMap[email]) emailMap[email] = [];
        emailMap[email].push(doc);
    }

    // Find duplicates — sort each group by createdAt asc, keep first, delete rest
    const toDelete = [];
    for (const [email, group] of Object.entries(emailMap)) {
        if (group.length <= 1) continue;

        // Sort oldest first
        group.sort((a, b) => {
            const ta = a.data().createdAt?.toMillis?.() ?? 0;
            const tb = b.data().createdAt?.toMillis?.() ?? 0;
            return ta - tb;
        });

        const keeper = group[0];
        const extras = group.slice(1);
        const keeperName = `${(group[0].data().firstName || '').trim()} ${(group[0].data().surname || '').trim()}`.trim();

        console.log(`📧 ${email} (${keeperName})`);
        console.log(`   Keeping:  ${keeper.id} (${keeper.data().createdAt?.toDate?.().toISOString() ?? 'unknown'})`);
        for (const extra of extras) {
            console.log(`   Deleting: ${extra.id} (${extra.data().createdAt?.toDate?.().toISOString() ?? 'unknown'}) — span=${((extra.data().createdAt?.toMillis?.() ?? 0) - (keeper.data().createdAt?.toMillis?.() ?? 0)) / 1000}s`);
            toDelete.push(extra.ref);
        }
    }

    console.log(`\n${'─'.repeat(55)}`);
    console.log(`Docs to delete: ${toDelete.length}`);

    if (toDelete.length === 0) {
        console.log('✅ No duplicates found. Nothing to delete.');
        process.exit(0);
    }

    if (DRY_RUN) {
        console.log('\n🟡 DRY RUN — no documents were deleted.');
        console.log('   Set DRY_RUN = false to execute the cleanup.');
        process.exit(0);
    }

    // Delete in batches of 500
    console.log('\nDeleting duplicates...');
    const BATCH_SIZE = 400;
    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = toDelete.slice(i, i + BATCH_SIZE);
        chunk.forEach(ref => batch.delete(ref));
        await batch.commit();
        deleted += chunk.length;
        console.log(`  Deleted ${deleted}/${toDelete.length}...`);
    }

    console.log(`\n✅ Cleanup complete. Deleted ${deleted} duplicate documents.`);
    console.log(`   Unique applications remaining: ${Object.keys(emailMap).length}`);
    process.exit(0);
}

main().catch(err => { console.error('❌ Fatal error:', err); process.exit(1); });
