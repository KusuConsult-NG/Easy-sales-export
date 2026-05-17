import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection('cooperative_members').get();
    let approved = 0;
    snap.docs.forEach(doc => {
        if (doc.data().membershipStatus === 'approved') approved++;
    });
    console.log(`Coop exactly approved: ${approved}`);
}

test().then(() => process.exit(0));
