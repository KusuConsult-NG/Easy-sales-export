import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection('cooperatives').get();
    let approved = 0;
    snap.docs.forEach(d => {
        const data = d.data();
        if (data.status === 'approved' || data.membershipStatus === 'approved') approved++;
    });
    console.log(`Total cooperatives: ${snap.size}`);
    console.log(`Approved cooperatives: ${approved}`);
}

test().then(() => process.exit(0));
