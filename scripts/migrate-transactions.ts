import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, WriteBatch } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

if (!getApps().length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!privateKey) throw new Error('Missing FIREBASE_PRIVATE_KEY in .env.local');
    // Handle escaped newlines
    privateKey = privateKey.replace(/\\n/g, '\n').replace(/^"|"$/g, '');

    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

const db = getFirestore();

// Firestore limits batches to 500 writes — this helper commits in safe chunks
async function commitInChunks(writes: Array<{ ref: FirebaseFirestore.DocumentReference; data: object }>) {
    const CHUNK = 500;
    for (let i = 0; i < writes.length; i += CHUNK) {
        const batch: WriteBatch = db.batch();
        const chunk = writes.slice(i, i + CHUNK);
        chunk.forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
        await batch.commit();
        console.log(`  ✓ Committed chunk ${Math.floor(i / CHUNK) + 1} (${chunk.length} docs)`);
    }
}

async function runMigration() {
    console.log('🚀 Starting unified transaction migration...\n');
    const writes: Array<{ ref: FirebaseFirestore.DocumentReference; data: object }> = [];

    // 1. Processed Payments
    console.log('  → Reading processedPayments...');
    const ppSnap = await db.collection('processedPayments').get();
    ppSnap.docs.forEach(doc => {
        const d = doc.data();
        writes.push({
            ref: db.collection('transactions').doc(doc.id),
            data: {
                id: doc.id,
                userId: d.userId || 'system',
                type: d.type || 'unknown',
                module: d.type?.includes('wave') ? 'wave'
                    : d.type?.includes('cooperative') ? 'cooperative'
                    : d.type?.includes('export') ? 'export'
                    : d.type?.includes('farm_nation') ? 'farm_nation'
                    : d.type?.includes('academy') ? 'academy'
                    : 'marketplace',
                amount: Number(d.amount) || 0,
                currency: 'NGN',
                status: 'completed',
                date: d.processedAt || FieldValue.serverTimestamp(),
                reference: d.reference || doc.id,
                description: `Payment for ${d.type || 'unknown'}`,
                metadata: d,
            },
        });
    });
    console.log(`     Found ${ppSnap.size} documents`);

    // 2. Cooperative Transactions
    console.log('  → Reading cooperative_transactions...');
    const coopSnap = await db.collection('cooperative_transactions').get();
    coopSnap.docs.forEach(doc => {
        const d = doc.data();
        writes.push({
            ref: db.collection('transactions').doc(doc.id),
            data: {
                id: doc.id,
                userId: d.userId || 'system',
                type: d.type || 'contribution',
                module: 'cooperative',
                amount: Number(d.amount) || 0,
                currency: 'NGN',
                status: d.status || 'completed',
                date: d.date || d.createdAt || FieldValue.serverTimestamp(),
                reference: d.reference || doc.id,
                description: d.description || 'Cooperative transaction',
                metadata: d,
            },
        });
    });
    console.log(`     Found ${coopSnap.size} documents`);

    // 3. Wallet Transactions
    console.log('  → Reading wallet_transactions...');
    const walletSnap = await db.collection('wallet_transactions').get();
    walletSnap.docs.forEach(doc => {
        const d = doc.data();
        writes.push({
            ref: db.collection('transactions').doc(doc.id),
            data: {
                id: doc.id,
                userId: d.userId || 'system',
                type: d.type || 'wallet_transfer',
                module: 'wallet',
                amount: Number(d.amount) || 0,
                currency: 'NGN',
                status: d.status || 'completed',
                date: d.createdAt || FieldValue.serverTimestamp(),
                reference: d.reference || doc.id,
                description: d.description || 'Wallet transaction',
                metadata: d,
            },
        });
    });
    console.log(`     Found ${walletSnap.size} documents`);

    // 4. Escrow Transactions
    console.log('  → Reading escrow_transactions...');
    const escrowSnap = await db.collection('escrow_transactions').get();
    escrowSnap.docs.forEach(doc => {
        const d = doc.data();
        writes.push({
            ref: db.collection('transactions').doc(doc.id),
            data: {
                id: doc.id,
                userId: d.buyerId || 'system',
                type: 'escrow_payment',
                module: 'marketplace',
                amount: Number(d.amount) || 0,
                currency: 'NGN',
                status: d.status || 'completed',
                date: d.createdAt || FieldValue.serverTimestamp(),
                reference: d.id || doc.id,
                description: `Escrow for order ${d.orderId || 'unknown'}`,
                metadata: d,
            },
        });
    });
    console.log(`     Found ${escrowSnap.size} documents`);

    console.log(`\n📦 Total records to migrate: ${writes.length}`);

    if (writes.length === 0) {
        console.log('ℹ️  Nothing to migrate. All source collections are empty.');
        return;
    }

    console.log('\n⏳ Writing to transactions collection (in 500-doc chunks)...');
    await commitInChunks(writes);

    console.log(`\n✅ Migration complete! ${writes.length} transactions unified.`);
}

runMigration().catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
