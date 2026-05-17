import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection('cooperative_members').get();
    const stateCounts: Record<string, number> = {};
    snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.membershipStatus === 'approved' || data.membershipStatus === 'active' || data.membershipStatus === 'completed' || data.membershipStatus === 'paid') {
            const state = data.state || 'Unknown';
            stateCounts[state] = (stateCounts[state] || 0) + 1;
        }
    });
    console.log(stateCounts);
}

test().then(() => process.exit(0));
