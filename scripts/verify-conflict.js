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
    
    let conflictCount = 0;
    mem.docs.forEach(doc => {
        const m = doc.data();
        const isActive = m.membershipStatus === "active" || m.membershipStatus === "approved" || m.status === "active" || m.status === "approved";
        const isPending = m.membershipStatus === "pending" || m.status === "pending" || (!m.membershipStatus && !m.status);
        if (isActive && isPending) {
            conflictCount++;
            console.log("Conflict: ", doc.id, m.status, m.membershipStatus);
        }
    });
    console.log("Total conflicts: ", conflictCount);
}
check();
