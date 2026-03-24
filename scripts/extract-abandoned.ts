import { getAdminDb } from '../src/lib/firebase-admin';
import { config } from 'dotenv';
import * as fs from 'fs';

config({ path: '.env.local' });
const db = getAdminDb();

async function extractAbandonedUsers() {
    console.log("Memory-Safe Cooperative Abandonment Scanner starting...");
    const USERS_BATCH_SIZE = 1000;

    let lastDoc = null;
    let hasMore = true;
    let totalScanned = 0;
    const validTargets: Array<{ id: string, email: string, name: string }> = [];

    while (hasMore) {
        let query = db.collection('users').orderBy("__name__").limit(USERS_BATCH_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snap = await query.get();
        if (snap.empty) {
            hasMore = false;
            break;
        }

        totalScanned += snap.size;
        lastDoc = snap.docs[snap.docs.length - 1];

        // Process batch safely
        for (const doc of snap.docs) {
            const data = doc.data();

            // Fast filter logic: Must have clicked 'Join' and have an email
            if (data.cooperativeId && data.email) {
                const memberDoc = await db.collection('cooperative_members').doc(doc.id).get();

                // If the memberDoc does not exist, or the payment wasn't finalized...
                // THIS is our deleted 537 cohort.
                if (!memberDoc.exists || memberDoc.data()?.paymentStatus !== 'completed') {
                    validTargets.push({
                        id: doc.id,
                        email: data.email,
                        name: data.fullName || data.firstName || 'Member'
                    });
                }
            }
        }

        console.log(`Scanned: ${totalScanned} | Current Targets Found: ${validTargets.length}`);
    }

    console.log("\n=========================");
    console.log("SCAN COMPLETE");
    console.log(`Total DB Users Scanned: ${totalScanned}`);
    console.log(`Abandoned Users Found: ${validTargets.length}`);
    console.log("=========================\n");

    if (validTargets.length > 0) {
        fs.writeFileSync('abandoned_users_dump.json', JSON.stringify(validTargets, null, 2));
        console.log("✅ Wrote targets to 'abandoned_users_dump.json'");
    }
}

extractAbandonedUsers().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
