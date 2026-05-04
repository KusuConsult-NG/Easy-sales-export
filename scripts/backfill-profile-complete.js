/**
 * Backfill profileComplete: true for all existing users who have
 * a phone number (meaning they've already completed registration).
 * Run once after deploying the profileComplete flag feature.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

if (!getApps().length) {
    initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
}

const db = getFirestore();

async function backfill() {
    console.log('Fetching all users...');
    const snapshot = await db.collection('users').get();
    
    let updated = 0;
    let skipped = 0;
    let alreadyDone = 0;

    const batch = db.batch();

    for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // Already has the flag — skip
        if (data.profileComplete === true) {
            alreadyDone++;
            continue;
        }
        
        // Mark complete if they have name + email + phone (fully onboarded users)
        const hasName = Boolean(data.fullName || (data.firstName && data.lastName));
        const hasEmail = Boolean(data.email);
        const hasPhone = Boolean(data.phone);
        
        if (hasName && hasEmail && hasPhone) {
            batch.update(doc.ref, { profileComplete: true });
            updated++;
            console.log(`  ✓ Will mark complete: ${data.email || doc.id}`);
        } else {
            skipped++;
            console.log(`  ⚠ Skipping (incomplete): ${data.email || doc.id} | name:${hasName} email:${hasEmail} phone:${hasPhone}`);
        }
    }

    if (updated > 0) {
        await batch.commit();
        console.log(`\n✅ Backfill complete. Marked ${updated} users as profileComplete.`);
    } else {
        console.log('\nNo updates needed.');
    }
    console.log(`Already complete: ${alreadyDone} | Skipped (incomplete profiles): ${skipped}`);
}

backfill().catch(console.error);
