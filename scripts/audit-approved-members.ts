import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Initialize Firebase Admin
if (getApps().length === 0) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}
const db = getFirestore();

async function auditApprovedMembers() {
    console.log("=== Auditing Cooperative Members ===");
    
    const snapshot = await db.collection("cooperative_members").get();
    let total = snapshot.size;
    
    let paidCount = 0;
    let approvedCount = 0;
    let activeCount = 0;
    let pendingCount = 0;
    
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        
        if (data.paymentStatus === 'completed') {
            paidCount++;
        }
        
        if (data.membershipStatus === 'approved' || data.status === 'approved') {
            approvedCount++;
        } else if (data.membershipStatus === 'active' || data.status === 'active') {
            activeCount++;
        } else if (data.membershipStatus === 'pending' || data.status === 'pending' || (!data.membershipStatus && !data.status)) {
            pendingCount++;
        }
    });
    
    console.log(`Total Cooperative Members: ${total}`);
    console.log(`Paid Members (paymentStatus = completed): ${paidCount}`);
    console.log(`Approved (status/membershipStatus = approved): ${approvedCount}`);
    console.log(`Active (status/membershipStatus = active): ${activeCount}`);
    console.log(`Pending: ${pendingCount}`);
    console.log(`Dashboard Approved sum (Approved + Active): ${approvedCount + activeCount}`);
    
    // Output sample of Active ones
    if (activeCount > 0) {
        console.log("\nSample of Active (status/membershipStatus = active):");
        const samples = snapshot.docs
            .filter(d => d.data().membershipStatus === 'active' || d.data().status === 'active')
            .slice(0, 5)
            .map(d => ({
                id: d.id,
                email: d.data().email,
                membershipStatus: d.data().membershipStatus,
                status: d.data().status,
                paymentStatus: d.data().paymentStatus
            }));
        console.table(samples);
    }
}

auditApprovedMembers().catch(console.error);
