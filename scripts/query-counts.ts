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
    const membersSnap = await db.collection("cooperative_members").get();
    let pending = 0;
    let approved = 0;
    let suspended = 0;
    let paid = 0;
    let other = 0;

    let noStatus = 0;
    
    let paidAndApproved = 0;
    let paidAndPending = 0;
    
    membersSnap.docs.forEach(doc => {
        const m = doc.data();
        const isActive = m.membershipStatus === "active" || m.membershipStatus === "approved" ||
                         m.status === "active" || m.status === "approved";
        const isSuspended = m.membershipStatus === "suspended" || m.status === "suspended";
        const isPending = m.membershipStatus === "pending" || m.status === "pending" || (!m.membershipStatus && !m.status);
        
        if (isActive) approved++;
        else if (isSuspended) suspended++;
        else if (isPending) pending++;
        else {
            other++;
        }
        
        if (m.paymentStatus === 'completed') {
            paid++;
            if (isActive) paidAndApproved++;
            if (isPending) paidAndPending++;
        }
    });

    console.log({ total: membersSnap.size, approved, suspended, pending, other, paid, paidAndApproved, paidAndPending });
}

main().catch(console.error);
