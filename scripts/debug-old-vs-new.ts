import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

// Simulate OLD code behavior: cooperative_members audience falling through to USERS stream
// with serviceRegistrations.cooperative lookup + "approved" filter
async function oldCodePath() {
    const snap = await db.collection('users').select('email', 'userEmail', 'serviceRegistrations').get();
    const emailMap = new Map<string, string>();
    snap.docs.forEach(doc => {
        const d = doc.data();
        const coopReg = d.serviceRegistrations?.cooperative;
        if (!coopReg) return;
        const ENROLLED = new Set(['pending', 'under_review', 'approved', 'active', 'paid', 'completed', 'suspended']);
        if (!ENROLLED.has(coopReg.status)) return;
        
        // Apply "approved" filter
        if (coopReg.status !== 'approved' && coopReg.status !== 'active' && coopReg.status !== 'paid' && coopReg.status !== 'completed') return;
        
        const email = d.email || d.userEmail;
        if (email) emailMap.set(email.toLowerCase(), email);
    });
    return emailMap.size;
}

async function test() {
    const oldCount = await oldCodePath();
    console.log(`OLD code (USERS stream, approved filter): ${oldCount} recipients`);
    
    // Fetch template-member@example.com in users collection
    const s = await db.collection('users').where('email', '==', 'template-member@example.com').get();
    console.log(`template-member@example.com in USERS: ${s.size > 0 ? 'YES' : 'NO'}`);
    
    const s2 = await db.collection('cooperative_members').where('email', '==', 'template-member@example.com').get();
    if (s2.size > 0) {
        console.log('template-member in cooperative_members:', JSON.stringify(s2.docs[0].data()));
    }
}

test().then(() => process.exit(0));
