import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function trace() {
    console.log('=== TRACING COOPERATIVE BROADCAST LIVE ===');
    
    // Step 1: What does cooperative_members collection return?
    const coopSnap = await db.collection('cooperative_members').get();
    console.log(`cooperative_members total docs: ${coopSnap.size}`);
    
    // Step 2: What does processedPayments return?
    const paymentsSnap = await db.collection('processedPayments')
        .where('type', '==', 'cooperative_membership_registration')
        .where('status', '==', 'completed')
        .get();
    console.log(`processedPayments (completed coop): ${paymentsSnap.size}`);
    
    const paidUserIds = new Set(paymentsSnap.docs.map(d => d.data().userId));
    console.log('Paid userIds count:', paidUserIds.size);
    
    // Step 3: Match coop members with paid
    let approved = 0, pending = 0, total = 0;
    const validEntries: {userId: string, status: string, email?: string}[] = [];
    
    for (const doc of coopSnap.docs) {
        const d = doc.data();
        const userId = d.userId || doc.id;
        if (!paidUserIds.has(userId)) continue;
        
        let status = d.membershipStatus || d.status || 'pending';
        if (['under_review','submitted','pending_review'].includes(status)) status = 'pending';
        if (status === 'not_started') continue;
        
        total++;
        if (['approved','active','paid','completed'].includes(status)) { approved++; validEntries.push({userId, status, email: d.email}); }
        else if (status === 'pending') pending++;
    }
    
    console.log(`After payment filter: total=${total}, approved=${approved}, pending=${pending}`);
    console.log('Sample approved entries:', validEntries.slice(0, 5).map(e => ({userId: e.userId, email: e.email})));
    
    // Step 4: Try to resolve emails
    let emailCount = 0;
    for (let i = 0; i < validEntries.length; i += 30) {
        const chunk = validEntries.slice(i, i+30);
        const refs = chunk.map(e => db.collection('users').doc(e.userId));
        const userDocs = await db.getAll(...refs);
        userDocs.forEach((ud, idx) => {
            if (!ud.exists) { console.log(`  MISSING user doc: ${chunk[idx].userId}`); return; }
            const email = ud.data()?.email || ud.data()?.userEmail;
            if (email) emailCount++;
            else console.log(`  NO EMAIL in user doc: ${chunk[idx].userId}`);
        });
    }
    console.log(`Final email count: ${emailCount}`);
}

trace().then(() => process.exit(0));
