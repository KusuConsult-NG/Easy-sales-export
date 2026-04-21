/**
 * delete-before-feb24.js
 *
 * Deletes all Firebase Auth users AND Firestore documents whose creation
 * timestamp is BEFORE 2026-02-24T00:00:00 UTC, while staying within all
 * Firebase / Firestore API limits:
 *
 *   Auth.listUsers()   → max 1 000 per page
 *   Auth.deleteUsers() → max 1 000 per call
 *   Firestore batch    → max 500 writes per commit
 *   Firestore query    → paginated with .limit(500).startAfter(cursor)
 *
 * Usage:
 *   node scripts/delete-before-feb24.js            # DRY RUN (safe preview)
 *   node scripts/delete-before-feb24.js --execute  # LIVE DELETE
 */

'use strict';

const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

/** Documents created BEFORE this moment will be deleted.
 *  = delete everything up to and including 2026-02-24  */
const CUTOFF = new Date('2026-02-25T00:00:00.000Z');

/** Dry-run by default — pass --execute to actually delete. */
const DRY_RUN = !process.argv.includes('--execute');

// API / batch limits
const AUTH_PAGE_SIZE = 1000; // listUsers max
const AUTH_DELETE_SIZE = 1000; // deleteUsers max
const FS_PAGE_SIZE = 500;  // Firestore query page
const FS_BATCH_SIZE = 500;  // Firestore batch-write max

// Timestamp field names recognised across all collections
const TS_FIELDS = ['createdAt', 'timestamp', 'creationTime', 'appliedAt', 'issuedAt', 'scheduledAt', 'requestedAt', 'submittedAt', 'completedAt', 'reviewedAt', 'approvedAt', 'rejectedAt', 'enrolledAt'];

// ─── Init ─────────────────────────────────────────────────────────────────────
const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) {
    console.error('❌  Missing Firebase Admin credentials in .env.local');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
    }),
});

const db = admin.firestore();
const auth = admin.auth();

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Returns true if any recognised timestamp field is before CUTOFF. */
function docIsOld(data) {
    for (const field of TS_FIELDS) {
        const v = data[field];
        if (!v) continue;
        const d = v?.toDate ? v.toDate() : new Date(v);
        if (!isNaN(d.getTime()) && d < CUTOFF) return true;
    }
    return false;
}

/** Chunk an array into arrays of at most `size` elements. */
function chunks(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ─── Firebase Auth ────────────────────────────────────────────────────────────
async function processAuth() {
    console.log('\n🔐  Scanning Firebase Auth users...');

    const oldUsers = [];
    let pageToken;
    let pageCount = 0;

    // Paginate through all users (max AUTH_PAGE_SIZE per page)
    do {
        const result = await auth.listUsers(AUTH_PAGE_SIZE, pageToken);
        pageCount++;
        for (const user of result.users) {
            const created = new Date(user.metadata.creationTime);
            if (created < CUTOFF) {
                oldUsers.push({ uid: user.uid, email: user.email || '(no email)', created: user.metadata.creationTime });
            }
        }
        pageToken = result.pageToken;
    } while (pageToken);

    console.log(`  Scanned ${pageCount} page(s) · Found ${oldUsers.length} user(s) before ${CUTOFF.toISOString()}`);

    if (oldUsers.length === 0) {
        console.log('  Nothing to delete in Auth.');
        return 0;
    }

    // Preview
    oldUsers.forEach(u =>
        console.log(`  ${DRY_RUN ? '[DRY RUN]' : 'Deleting'} – ${u.email}  (created: ${u.created})`));

    if (DRY_RUN) {
        console.log(`\n  ⏭️  Dry-run: would delete ${oldUsers.length} auth user(s).`);
        return oldUsers.length;
    }

    // Delete in batches of AUTH_DELETE_SIZE
    let deleted = 0;
    for (const batch of chunks(oldUsers.map(u => u.uid), AUTH_DELETE_SIZE)) {
        const res = await auth.deleteUsers(batch);
        deleted += res.successCount;
        if (res.failureCount > 0) {
            console.warn(`  ⚠️  ${res.failureCount} deletion(s) failed:`);
            res.errors.forEach(e => console.warn(`    – ${e.error.message}`));
        }
        console.log(`  ✔  Batch deleted ${res.successCount} auth user(s).`);
    }

    console.log(`  ✅  Auth: ${deleted} user(s) deleted.`);
    return deleted;
}

// ─── Firestore ────────────────────────────────────────────────────────────────
/**
 * Paginate through a collection, collect refs of old documents,
 * then commit them in batches. Recurses into subcollections.
 */
async function processCollection(colRef, colPath, depth = 0) {
    const pad = '  '.repeat(depth + 1);
    let totalDeleted = 0;
    let cursor = null;
    let pageCount = 0;

    // Collect all old document references via paginated full-scan
    const toDelete = [];

    while (true) {
        let query = colRef.orderBy(admin.firestore.FieldPath.documentId()).limit(FS_PAGE_SIZE);
        if (cursor) query = query.startAfter(cursor);

        const snap = await query.get();
        pageCount++;

        if (snap.empty) break;
        cursor = snap.docs[snap.docs.length - 1];

        for (const doc of snap.docs) {
            if (docIsOld(doc.data())) {
                // Recurse into subcollections first so parent delete is safe
                const subs = await doc.ref.listCollections();
                for (const sub of subs) {
                    totalDeleted += await processCollection(sub, `${colPath}/${doc.id}/${sub.id}`, depth + 1);
                }
                toDelete.push(doc.ref);
                console.log(`${pad}${DRY_RUN ? '[DRY RUN]' : 'Queued'}  ${colPath}/${doc.id}`);
            }
        }

        if (snap.size < FS_PAGE_SIZE) break; // last page
    }

    if (toDelete.length === 0) return totalDeleted;

    if (DRY_RUN) {
        console.log(`${pad}↳  Would delete ${toDelete.length} doc(s) from "${colPath}" (${pageCount} page(s) scanned)`);
        return totalDeleted + toDelete.length;
    }

    // Commit in batches of FS_BATCH_SIZE
    for (const batch of chunks(toDelete, FS_BATCH_SIZE)) {
        const writeBatch = db.batch();
        batch.forEach(ref => writeBatch.delete(ref));
        await writeBatch.commit();
        console.log(`${pad}✔  Committed batch of ${batch.length} deletion(s) in "${colPath}"`);
    }

    totalDeleted += toDelete.length;
    return totalDeleted;
}

async function processFirestore() {
    console.log('\n🗄️   Scanning Firestore collections...');

    const collections = await db.listCollections();
    if (collections.length === 0) {
        console.log('  No collections found.');
        return 0;
    }

    let grand = 0;
    for (const col of collections) {
        const count = await processCollection(col, col.id);
        if (count > 0) {
            console.log(`  → "${col.id}": ${count} doc(s) ${DRY_RUN ? 'matched' : 'deleted'}`);
            grand += count;
        }
    }

    if (grand === 0) console.log('  No documents found before the cutoff date.');
    else console.log(`\n  ${DRY_RUN ? `⏭️  Dry-run total: ${grand} doc(s) would be deleted.` : `✅  Firestore: ${grand} doc(s) deleted.`}`);

    return grand;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const modeLabel = DRY_RUN
        ? '🔍  DRY RUN  – nothing will be deleted'
        : '🔴  LIVE     – records will be permanently deleted';

    const LINE = '═'.repeat(58);
    console.log(`╔${LINE}╗`);
    console.log('║   DELETE AUTH & DB RECORDS · BEFORE 24 FEB 2026         ║');
    console.log(`║   Project : ${String(process.env.FIREBASE_PROJECT_ID).padEnd(45)}║`);
    console.log(`║   Cutoff  : ${CUTOFF.toISOString().padEnd(45)}║`);
    console.log(`║   Mode    : ${modeLabel.padEnd(45)}║`);
    console.log(`╚${LINE}╝`);

    if (!DRY_RUN) {
        console.log('\n⚠️  Starting in 5 seconds — press Ctrl+C to abort.\n');
        await new Promise(r => setTimeout(r, 5000));
    }

    console.log('\n  Limits in use:');
    console.log(`    Auth list page  : ${AUTH_PAGE_SIZE}/call`);
    console.log(`    Auth delete     : ${AUTH_DELETE_SIZE}/call`);
    console.log(`    Firestore page  : ${FS_PAGE_SIZE} docs/page`);
    console.log(`    Firestore batch : ${FS_BATCH_SIZE} writes/commit`);

    try {
        const authCount = await processAuth();
        const dbCount = await processFirestore();

        console.log(`\n╔${LINE}╗`);
        if (DRY_RUN) {
            console.log('║  DRY RUN COMPLETE — nothing was deleted                  ║');
            console.log(`║  Auth users matched   : ${String(authCount).padEnd(32)}║`);
            console.log(`║  Firestore docs matched: ${String(dbCount).padEnd(31)}║`);
            console.log('╠' + LINE + '╣');
            console.log('║  Re-run with --execute to perform the actual deletion.   ║');
        } else {
            console.log('║  ✅  DELETION COMPLETE                                    ║');
            console.log(`║  Auth users deleted   : ${String(authCount).padEnd(32)}║`);
            console.log(`║  Firestore docs deleted: ${String(dbCount).padEnd(31)}║`);
        }
        console.log(`╚${LINE}╝\n`);
    } catch (err) {
        console.error('\n❌  Fatal error:', err.message);
        console.error(err.stack);
        process.exit(1);
    }

    process.exit(0);
}

main();
