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
    console.log("Restoring TRUE paid users...");
    
    let paymentEmails = new Set();
    let paymentUids = new Set();

    const addRecord = (d: any) => {
        if (d.userId) paymentUids.add(d.userId);
        if (d.email) paymentEmails.add(d.email.toLowerCase());
        if (d.customer?.email) paymentEmails.add(d.customer.email.toLowerCase());
    }

    // 1. ProcessedPayments
    const processedSnap = await db.collection("processedPayments").get();
    processedSnap.docs.forEach(doc => {
        const d = doc.data();
        const type = d.type || d.paymentType || d.metadata?.type || '';
        if (type.includes('cooperative') && (d.status === 'success' || d.status === 'completed' || !d.status)) {
            addRecord(d);
        }
    });

    // 2. Transactions
    const txSnap = await db.collection("transactions").get();
    txSnap.docs.forEach(doc => {
        const d = doc.data();
        if ((d.type === 'membership_registration' || d.module === 'cooperative') && 
            (d.status === 'completed' || d.status === 'success')) {
            addRecord(d);
        }
    });

    // 3. cooperative_transactions
    const coopTxSnap = await db.collection("cooperative_transactions").get();
    coopTxSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.status === 'completed' || d.status === 'success') {
            addRecord(d);
        }
    });

    // 4. payments
    const paymentsSnap = await db.collection("payments").get();
    paymentsSnap.docs.forEach(doc => {
        const d = doc.data();
        if ((d.type === 'membership_registration' || d.module === 'cooperative' || d.purpose === 'cooperative') && 
            (d.status === 'completed' || d.status === 'success')) {
            addRecord(d);
        }
    });

    const membersSnap = await db.collection("cooperative_members").get();
    let batch = db.batch();
    let updates = 0;
    
    for (let doc of membersSnap.docs) {
        const d = doc.data();
        const uid = doc.id;
        const email = d.email ? d.email.toLowerCase() : '';
        
        let hasPayment = false;
        if (paymentUids.has(uid)) hasPayment = true;
        if (email && paymentEmails.has(email)) hasPayment = true;
        if (d.paymentReference || d.paystackRef || d.reference) hasPayment = true;
        
        if (hasPayment && d.paymentStatus !== 'completed') {
            batch.update(doc.ref, {
                paymentStatus: 'completed'
            });
            updates++;
            
            if (updates % 400 === 0) {
                await batch.commit();
                batch = db.batch();
            }
        }
    }

    if (updates > 0) {
        await batch.commit();
        console.log(`Successfully restored ${updates} users to paymentStatus: 'completed'`);
    } else {
        console.log("No users needed restoring.");
    }
}
main().catch(console.error);
