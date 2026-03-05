import { getAdminDb } from './src/lib/firebase-admin';
import { config } from 'dotenv';
config({ path: '.env.local' });
const db = getAdminDb();

async function check() {
    const snapshot = await db.collection('cooperative_members').get();
    let pendingCount = 0;
    let compCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.paymentStatus && data.paymentStatus !== 'completed') {
            pendingCount++;
        } else {
            compCount++;
        }
    }

    console.log(`cooperative_members pending/abandoned: ${pendingCount}`);
    console.log(`cooperative_members completed: ${compCount}`);
}
check().then(() => process.exit(0));
