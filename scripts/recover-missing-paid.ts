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
    
    let usersToRestore = [];
    
    for (let uid of paidButNotInMembers) {
        try {
            const doc = await db.collection("users").doc(uid).get();
            if (doc.exists) {
                usersToRestore.push({ uid, data: doc.data() });
            }
        } catch (e) {
            console.error(`Error fetching user ${uid}:`, e);
        }
    }
    
    console.log(`${usersToRestore.length} of them exist in the central users collection. Generating application records...`);
    
    let batch = db.batch();
    let count = 0;
    
    for (let user of usersToRestore) {
        const uid = user.uid;
        const d = user.data;
        
        // We recreate their application using basic info
        const newApp = {
            userId: uid,
            email: d.email || '',
            firstName: d.firstName || d.name?.split(' ')[0] || '',
            lastName: d.lastName || d.name?.split(' ').slice(1).join(' ') || '',
            phone: d.phone || d.phoneNumber || '',
            status: 'pending', // The application is pending approval
            paymentStatus: 'completed', // They have paid!
            membershipStatus: 'pending', // Pending admin approval
            tier: 'basic',
            createdAt: d.createdAt || admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            metadata: {
                healedByScript: true,
                reason: "Recovered from orphan payment record",
                recoveredAt: new Date().toISOString()
            }
        };
        
        batch.set(db.collection("cooperative_members").doc(uid), newApp);
        count++;
        
        if (count % 400 === 0) {
            await batch.commit();
            batch = db.batch();
        }
    }
    
    if (count > 0) {
        await batch.commit();
        console.log(`Successfully generated ${count} missing cooperative applications!`);
    } else {
        console.log("No missing users found in the central users collection.");
    }
}

main().catch(console.error);
