import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const [membersSnap, paymentsSnap] = await Promise.all([
        db.collection('cooperative_members').get(),
        db.collection('processedPayments').where("type", "==", "cooperative_membership_registration").where("status", "==", "completed").get()
    ]);
    const paidUserIds = new Set(paymentsSnap.docs.map(d => d.data().userId));
    let approvedPaid = 0;
    membersSnap.docs.forEach(doc => {
        const d = doc.data();
        if ((d.membershipStatus === 'approved' || d.membershipStatus === 'active' || d.membershipStatus === 'completed' || d.membershipStatus === 'paid') && paidUserIds.has(d.userId || doc.id)) {
            approvedPaid++;
        }
    });
    console.log(`Approved and PAID cooperative members: ${approvedPaid}`);
}

test().then(() => process.exit(0));
