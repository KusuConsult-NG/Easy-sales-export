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
        const type = d.type || d.paymentType || d.metadata?.type || '';
        if (type.includes('cooperative') && (d.status === 'success' || d.status === 'completed' || !d.status)) {
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

    console.log("Checking cooperative_members...");
    const membersSnap = await db.collection("cooperative_members").get();
    
    let membersIds = new Set();
    membersSnap.docs.forEach(doc => {
        membersIds.add(doc.id);
    });

    let paidButNotInMembers = [];

    for (let uid of processedIds) {
        if (!membersIds.has(uid)) {
            paidButNotInMembers.push(uid);
        }
    }

    console.log(`Found ${paidButNotInMembers.length} users who paid BUT ARE NOT in cooperative_members.`);
    
    let foundInUsers = 0;
    for (let uid of paidButNotInMembers) {
        const doc = await db.collection("users").doc(uid).get();
        if (doc.exists) {
            foundInUsers++;
        }
    }
    
    console.log(`${foundInUsers} of them exist in the central users collection.`);

}
main().catch(console.error);
