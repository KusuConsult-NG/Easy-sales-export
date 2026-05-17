import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

async function test() {
    const snap = await db.collection('cooperative_members').get();
    const approvedIds: string[] = [];
    snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.membershipStatus === 'approved' || d.membershipStatus === 'active' || d.membershipStatus === 'completed' || d.membershipStatus === 'paid') {
            approvedIds.push(doc.id);
        }
    });
    
    let resolved = 0;
    const auth = getAuth();
    for (let i = 0; i < approvedIds.length; i += 100) {
        const chunk = approvedIds.slice(i, i + 100);
        const result = await auth.getUsers(chunk.map(uid => ({ uid })));
        resolved += result.users.filter(u => u.email).length;
    }
    
    console.log(`Approved: ${approvedIds.length}`);
    console.log(`Resolved via Auth with email: ${resolved}`);
}

test().then(() => process.exit(0));
