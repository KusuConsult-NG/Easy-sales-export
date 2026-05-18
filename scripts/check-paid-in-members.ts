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
    let processedIds = new Set();
    processedSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.status === 'success' || d.status === 'completed' || !d.status) {
            processedIds.add(d.userId);
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

    console.log(`There are ${processedIds.size} unique user IDs that made payments.`);

    console.log("Checking cooperative_members...");
    const membersSnap = await db.collection("cooperative_members").get();
    
    let membersIds = new Set();
    membersSnap.docs.forEach(doc => {
        membersIds.add(doc.id);
    });

    let paidButNotInMembers = [];
    let paidAndInMembers = [];

    for (let uid of processedIds) {
        if (membersIds.has(uid)) {
            paidAndInMembers.push(uid);
        } else {
            paidButNotInMembers.push(uid);
        }
    }

    console.log(`Found ${paidAndInMembers.length} users who paid AND are in cooperative_members.`);
    console.log(`Found ${paidButNotInMembers.length} users who paid BUT ARE NOT in cooperative_members.`);
    
    let alreadyPaidCount = 0;
    let pendingCount = 0;
    
    for (let uid of paidAndInMembers) {
        const doc = membersSnap.docs.find(d => d.id === uid);
        if (doc?.data().paymentStatus === 'completed') {
            alreadyPaidCount++;
        } else if (doc?.data().paymentStatus === 'pending') {
            pendingCount++;
        }
    }
    
    console.log(`Of those ${paidAndInMembers.length} in cooperative_members:`);
    console.log(`${alreadyPaidCount} are marked completed`);
    console.log(`${pendingCount} are marked pending`);
    
}
main().catch(console.error);
