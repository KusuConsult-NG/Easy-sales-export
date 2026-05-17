import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

// Simulate what the OLD code (before fixes) would do with cooperative_members
// The 22 recipients + 38k records matched means it hit the USERS streaming path
// Let's check what audience=cooperative_members does in the USERS path (it falls through to categorizeUser)

import { db } from '../src/lib/firebase-admin';

async function test() {
    // Check what the old cooperative_members path did: it went to USERS collection
    // and matched users where categorizeUser(data) === "cooperative_members" 
    // Since categorizeUser doesn't return "cooperative_members", NONE match via categorizeUser
    // But the "else" branch checks serviceRegistrations
    // Let's find how many USERS have serviceRegistrations.cooperative status that matches
    
    const snap = await db.collection('users').select('email', 'serviceRegistrations').get();
    let count = 0;
    snap.docs.forEach(doc => {
        const d = doc.data();
        const coopReg = d.serviceRegistrations?.cooperative;
        if (coopReg && ['pending', 'under_review', 'approved', 'active', 'paid', 'completed', 'suspended'].includes(coopReg.status)) {
            count++;
        }
    });
    console.log(`USERS with serviceRegistrations.cooperative status: ${count}`);
}

test().then(() => process.exit(0));
