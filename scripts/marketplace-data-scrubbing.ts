// @ts-nocheck
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import { COLLECTIONS } from '../lib/types/firestore';

/**
 * Data Scrubbing Audit Script
 * Ensures all existing documents in critical collections have essential fields:
 * - createdAt
 * - updatedAt
 * - status (where applicable)
 * - role/roles (where applicable)
 * - _version (Optimistic Concurrency Control)
 */

dotenv.config({ path: '.env.local' });

if (!admin.apps.length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey?.startsWith('"') && privateKey?.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }
    if (privateKey?.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const db = admin.firestore();

async function scrubCollection(collectionName: string, defaults: Record<string, any>) {
    console.log(`\n--- Scrubbing Collection: ${collectionName} ---`);
    const snapshot = await db.collection(collectionName).get();
    console.log(`Total documents found: ${snapshot.size}`);

    let scrubbedCount = 0;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const updates: Record<string, any> = {};
        let needsUpdate = false;

        for (const [field, defaultValue] of Object.entries(defaults)) {
            if (data[field] === undefined || data[field] === null) {
                updates[field] = defaultValue === 'NOW' ? admin.firestore.FieldValue.serverTimestamp() : defaultValue;
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            batch.update(doc.ref, updates);
            scrubbedCount++;
            batchCount++;

            if (batchCount >= 500) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
                console.log(`Committed batch... (${scrubbedCount} scrubbed so far)`);
            }
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    console.log(`Finished scrubbing ${collectionName}. Total scrubbed: ${scrubbedCount}`);
}

async function main() {
    try {
        // 1. Users Collection
        await scrubCollection(COLLECTIONS.USERS, {
            createdAt: 'NOW',
            updatedAt: 'NOW',
            roles: ['user'],
            _version: 0,
        });

        // 2. Products Collection
        await scrubCollection(COLLECTIONS.PRODUCTS, {
            createdAt: 'NOW',
            updatedAt: 'NOW',
            status: 'active',
            views: 0,
            orders: 0,
            _version: 0,
        });

        // 3. Marketplace Orders Collection
        await scrubCollection(COLLECTIONS.MARKETPLACE_ORDERS, {
            createdAt: 'NOW',
            updatedAt: 'NOW',
            status: 'pending_payment',
            _version: 0,
        });

        // 4. Seller Verifications
        await scrubCollection(COLLECTIONS.SELLER_VERIFICATIONS, {
            createdAt: 'NOW',
            updatedAt: 'NOW',
            status: 'pending',
            _version: 0,
        });

        console.log('\n✅ Data scrubbing audit completed successfully!');
    } catch (error) {
        console.error('Data scrubbing audit failed:', error);
    }
}

main();
