import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, cert } from "firebase-admin/app";

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!privateKey) throw new Error("Missing FIREBASE_PRIVATE_KEY");

initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    }),
});

async function run() {
    const db = getFirestore();
    console.log("Starting reconciliation of Cooperative Members...");

    const paidMembersSnap = await db.collection("cooperative_members")
        .where("paymentStatus", "==", "completed")
        .get();
    
    let created = 0;
    
    // Batch processing to save time
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of paidMembersSnap.docs) {
        const member = doc.data();
        const userId = doc.id;
        
        // Ensure standard fields
        const fee = member.registrationFee || 10000;
        const joinedDate = member.createdAt || new Date();

        // Check if transaction exists
        const txSnap = await db.collection("cooperative_transactions")
            .where("userId", "==", userId)
            .where("type", "in", ["contribution", "membership_registration"])
            .get();
        
        if (txSnap.empty) {
            // Missing transaction found! Retro-actively create it.
            const newTxRef = db.collection("cooperative_transactions").doc(`LEGACY_RECON_${userId}`);
            batch.set(newTxRef, {
                userId: userId,
                cooperativeId: member.cooperativeId || null,
                type: "membership_registration",
                amount: fee,
                status: "completed",
                paymentMethod: member.paymentMethod || "legacy_import",
                reference: member.paymentReference || `REC-${Date.now()}-${userId.substring(0,4)}`,
                date: joinedDate, // Retain original creation date!
                description: "Retro-active membership registration fee (System Reconciliation)",
                createdAt: joinedDate,
                updatedAt: new Date()
            });
            created++;
            batchCount++;

            if (batchCount === 400) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }
    }
    
    if (batchCount > 0) {
        await batch.commit();
    }

    console.log(`\nReconciliation Complete!`);
    console.log(`Paid Members Found: ${paidMembersSnap.size}`);
    console.log(`Missing Transactions Generated: ${created}`);
}

run().catch(console.error);
