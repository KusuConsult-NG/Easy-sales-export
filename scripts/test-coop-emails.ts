import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection('cooperative_members').get();
    let approved = 0;
    let approvedWithUsersEmail = 0;
    
    for (const doc of snap.docs) {
        const d = doc.data();
        if (d.membershipStatus === 'approved' || d.membershipStatus === 'active' || d.membershipStatus === 'completed' || d.membershipStatus === 'paid') {
            approved++;
            const uSnap = await db.collection('USERS').doc(doc.id).get();
            if (uSnap.exists && uSnap.data()?.email) {
                approvedWithUsersEmail++;
            }
        }
    }
    
    console.log(`Approved: ${approved}`);
    console.log(`Approved AND have email in USERS: ${approvedWithUsersEmail}`);
}

test().then(() => process.exit(0));
