import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function countApproved(collection: string, statusField: string) {
    const snap = await db.collection(collection).get();
    let count = 0;
    snap.docs.forEach(doc => {
        const s = doc.data()[statusField];
        if (s === 'approved' || s === 'active' || s === 'completed' || s === 'paid') count++;
    });
    console.log(`${collection} approved: ${count}`);
}

async function test() {
    await countApproved('cooperative_members', 'membershipStatus');
    await countApproved('WAVE_applications', 'status');
    await countApproved('FARM_NATION_applications', 'status');
    await countApproved('EXPORT_applications', 'status');
    await countApproved('ACADEMY_applications', 'status');
    await countApproved('sellers_verification', 'status');
}

test().then(() => process.exit(0));
