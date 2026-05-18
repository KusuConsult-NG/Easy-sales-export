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
    const snap = await db.collection('cooperative_members').get();
    const allMembers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const totalApplications = allMembers.length;
    
    let pendingCount = 0;
    let approvedCount = 0;
    let paidMembersCount = 0;
    
    allMembers.forEach((m: any) => {
        if (m.paymentStatus === 'completed') {
            paidMembersCount++;
        }
        
        if (m.status === 'pending' || m.membershipStatus === 'pending') {
            pendingCount++;
        } else if (m.status === 'approved' || m.membershipStatus === 'approved') {
            approvedCount++;
        }
    });

    console.log({
        totalApplications,
        paidMembersCount,
        pendingCount,
        approvedCount
    });
}
main().catch(console.error);
