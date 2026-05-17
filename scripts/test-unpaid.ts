import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection("cooperative_members").get();
    
    let unpaidCount = 0;
    
    snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.paymentStatus !== 'completed' && d.paymentStatus !== 'paid' && d.paymentStatus !== 'successful') {
            unpaidCount++;
        }
    });
    
    console.log(`Unpaid cooperative_members: ${unpaidCount}`);
}

test().then(() => process.exit(0)).catch(console.error);
