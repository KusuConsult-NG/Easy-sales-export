import { config } from "dotenv";
config({ path: ".env.local" });
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}
const db = admin.firestore();

async function main() {
    console.log("Auditing and fixing fake paid users...");
    
    // 1. ProcessedPayments
    const processedSnap = await db.collection("processedPayments").get();
    const paidUsersInProcessed = new Set();
    processedSnap.docs.forEach(doc => {
        const d = doc.data();
        const type = d.type || d.paymentType || d.metadata?.type || '';
        if (type.includes('cooperative') && (d.status === 'success' || d.status === 'completed' || !d.status)) {
            paidUsersInProcessed.add(d.userId);
        }
    });

    // 2. Transactions
    const txSnap = await db.collection("transactions").get();
    const paidUsersInTx = new Set();
    txSnap.docs.forEach(doc => {
        const d = doc.data();
        if ((d.type === 'membership_registration' || d.module === 'cooperative') && 
            (d.status === 'completed' || d.status === 'success')) {
            paidUsersInTx.add(d.userId);
        }
    });

    // 3. cooperative_transactions
    const coopTxSnap = await db.collection("cooperative_transactions").get();
    const paidUsersInCoopTx = new Set();
    coopTxSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.status === 'completed' || d.status === 'success') {
            paidUsersInCoopTx.add(d.userId);
        }
    });

    // 4. payments
    const paymentsSnap = await db.collection("payments").get();
    const paidUsersInPayments = new Set();
    paymentsSnap.docs.forEach(doc => {
        const d = doc.data();
        if ((d.type === 'membership_registration' || d.module === 'cooperative' || d.purpose === 'cooperative') && 
            (d.status === 'completed' || d.status === 'success')) {
            paidUsersInPayments.add(d.userId);
        }
    });

    const membersSnap = await db.collection("cooperative_members").get();
    
    let batch = db.batch();
    let updates = 0;
    
    membersSnap.docs.forEach(doc => {
        const d = doc.data();
        const uid = doc.id;
        
        if (d.paymentStatus === 'completed') {
            const hasRecord = paidUsersInProcessed.has(uid) || 
                              paidUsersInTx.has(uid) || 
                              paidUsersInCoopTx.has(uid) || 
                              paidUsersInPayments.has(uid) || 
                              !!d.paymentReference || 
                              !!d.paystackRef || 
                              !!d.reference;
                              
            if (!hasRecord) {
                // FAKE PAID USER! Revert their status
                batch.update(doc.ref, {
                    paymentStatus: 'pending',
                    status: 'pending',
                    membershipStatus: 'pending'
                });
                updates++;
                
                // If updates get too large, we would commit here, but it's 250, so one batch is fine (limit 500)
            }
        }
    });

    if (updates > 0) {
        await batch.commit();
        console.log(`Successfully reverted ${updates} fake paid users back to pending.`);
    } else {
        console.log("No fake paid users found to revert.");
    }
}
main().catch(console.error);
