import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection('cooperative_members').get();
    let approvedAndPaid = 0;
    let justPaid = 0;
    snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.paymentStatus === 'completed' || d.paymentStatus === 'paid') {
            justPaid++;
            if (d.membershipStatus === 'approved' || d.membershipStatus === 'active' || d.membershipStatus === 'completed') {
                approvedAndPaid++;
            }
        }
    });
    console.log(`Coop members with payment completed: ${justPaid}`);
    console.log(`Coop members with payment completed AND approved: ${approvedAndPaid}`);
}

test().then(() => process.exit(0));
