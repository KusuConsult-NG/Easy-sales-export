require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (getApps().length === 0) {
    let key = process.env.FIREBASE_PRIVATE_KEY;
    if (key && key.startsWith('"')) key = key.slice(1, -1);
    if (key) key = key.replace(/\\n/g, '\n');
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: key
        })
    });
}
const db = getFirestore();

async function check() {
    const mem = await db.collection("cooperative_members").get();
    const pay = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const pIds = new Set();
    pay.docs.forEach(d => { if (d.data().userId) pIds.add(d.data().userId); });
    
    let pending = 0;
    let approved = 0;
    
    mem.docs.forEach(doc => {
        const d = doc.data();
        const st = d.membershipStatus || d.status;
        if (st === "active" || st === "approved") {
            approved++;
            pIds.add(doc.id); // implicitly paid
            pIds.add(d.userId);
        } else {
            pending++;
        }
    });
    
    console.log("Forms: ", mem.size);
    console.log("Payments: ", pay.size);
    console.log("Pending (Forms): ", pending);
    console.log("Approved (Forms): ", approved);
    console.log("Total unique Paid users: ", pIds.size);
}
check();
