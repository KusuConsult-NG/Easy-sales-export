import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection("cooperative_members").get();
    
    let paidCount = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    
    snap.docs.forEach(doc => {
        const d = doc.data();
        let status = d.membershipStatus || d.status || "pending";
        if (status === "under_review" || status === "submitted" || status === "pending_review") status = "pending";
        
        if (d.paymentStatus === 'paid' || d.paymentStatus === 'completed' || d.paymentStatus === 'successful') {
            paidCount++;
            if (status === 'approved' || status === 'active') {
                approvedCount++;
            } else if (status === 'pending') {
                pendingCount++;
            }
        }
    });
    
    console.log(`Total cooperative_members: ${snap.docs.length}`);
    console.log(`Paid count (from field): ${paidCount}`);
    console.log(`Approved (paid): ${approvedCount}`);
    console.log(`Pending (paid): ${pendingCount}`);
    
    const paySnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    console.log(`ProcessedPayments count: ${paySnap.docs.length}`);
    
    // How many of the 441 paid users are missing from processedPayments?
}

test().then(() => process.exit(0)).catch(console.error);
