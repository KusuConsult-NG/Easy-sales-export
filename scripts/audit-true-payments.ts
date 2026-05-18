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
    const snap = await db.collection("processedPayments").get();
    
    let totalPayments = snap.size;
    let coopPayments = 0;
    
    const uniqueCoopUsersWithCompleted = new Set();
    const typeCounts: Record<string, number> = {};

    snap.docs.forEach(doc => {
        const d = doc.data();
        
        const type = d.type || d.paymentType || d.metadata?.type || 'unknown';
        typeCounts[type] = (typeCounts[type] || 0) + 1;
        
        if (type.includes('cooperative')) {
            coopPayments++;
            uniqueCoopUsersWithCompleted.add(d.userId);
        }
    });

    console.log({
        totalPayments,
        coopPayments,
        uniqueCoopUsersWithCompleted: uniqueCoopUsersWithCompleted.size,
        typeCounts
    });
    
    // Check TRANSACTIONS as well
    const txSnap = await db.collection("transactions").get();
    let coopTx = 0;
    const uniqueCoopTxUsers = new Set();
    txSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.type === 'membership_registration' || d.module === 'cooperative') {
            if (d.status === 'completed' || d.status === 'success') {
                coopTx++;
                uniqueCoopTxUsers.add(d.userId);
            }
        }
    });
    console.log("Cooperative completed transactions in `transactions` collection:", coopTx, "Unique users:", uniqueCoopTxUsers.size);

    // Also let's output exactly how many members actually have `paymentStatus: 'completed'` right now:
    const membersSnap = await db.collection("cooperative_members").get();
    let paidMembersCount = 0;
    membersSnap.docs.forEach(doc => {
        if (doc.data().paymentStatus === 'completed') {
            paidMembersCount++;
        }
    });
    console.log("paymentStatus === 'completed' in cooperative_members:", paidMembersCount);
}
main().catch(console.error);
