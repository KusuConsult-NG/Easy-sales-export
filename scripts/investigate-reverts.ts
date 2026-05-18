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
    console.log("Fetching processedPayments...");
    const processedSnap = await db.collection("processedPayments").get();
    let processedEmails = new Set();
    let processedIds = new Set();
    processedSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.status === 'success' || d.status === 'completed' || !d.status) {
            processedIds.add(d.userId);
            if (d.customerEmail) processedEmails.add(d.customerEmail.toLowerCase().trim());
            if (d.metadata?.email) processedEmails.add(d.metadata.email.toLowerCase().trim());
        }
    });
    
    // Also transactions
    console.log("Fetching transactions...");
    const txSnap = await db.collection("transactions").get();
    txSnap.docs.forEach(doc => {
        const d = doc.data();
        if ((d.type === 'membership_registration' || d.module === 'cooperative') && 
            (d.status === 'completed' || d.status === 'success')) {
            processedIds.add(d.userId);
        }
    });

    // Also payments
    console.log("Fetching payments...");
    const pSnap = await db.collection("payments").get();
    pSnap.docs.forEach(doc => {
        const d = doc.data();
        if ((d.type === 'membership_registration' || d.module === 'cooperative') && 
            (d.status === 'completed' || d.status === 'success')) {
            processedIds.add(d.userId);
        }
    });

    console.log("Checking cooperative_members...");
    const membersSnap = await db.collection("cooperative_members").get();
    
    let toRestore = [];
    
    const pendingDocs = membersSnap.docs.filter(doc => doc.data().paymentStatus === 'pending');
    console.log(`There are ${pendingDocs.length} pending docs.`);

    const userPromises = pendingDocs.map(async (doc) => {
        const uid = doc.id;
        if (processedIds.has(uid)) {
            return uid;
        }
        try {
            const userDoc = await db.collection("users").doc(uid).get();
            const email = userDoc.data()?.email?.toLowerCase().trim();
            if (email && processedEmails.has(email)) {
                return uid;
            }
        } catch (e) {}
        return null;
    });

    const results = await Promise.all(userPromises);
    
    for (const uid of results) {
        if (uid) {
            toRestore.push(uid);
        }
    }

    console.log(`Found ${toRestore.length} members who should actually be marked as PAID!`);
    
    if (toRestore.length > 0) {
        let batch = db.batch();
        let count = 0;
        for (let uid of toRestore) {
            batch.update(db.collection("cooperative_members").doc(uid), {
                paymentStatus: "completed"
            });
            count++;
            if (count % 400 === 0) {
                await batch.commit();
                batch = db.batch();
            }
        }
        await batch.commit();
        console.log(`Successfully restored ${toRestore.length} members to paid status.`);
    }
}
main().catch(console.error);
