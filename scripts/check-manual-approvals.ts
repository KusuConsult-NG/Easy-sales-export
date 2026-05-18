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
    console.log("Checking approved members...");
    const membersSnap = await db.collection("cooperative_members").get();
    
    let approvedButPendingPayment = [];
    let pendingWithApprovalData = [];
    
    for (let doc of membersSnap.docs) {
        const d = doc.data();
        if ((d.status === 'approved' || d.membershipStatus === 'approved') && d.paymentStatus === 'pending') {
            approvedButPendingPayment.push(doc.id);
        }
        if (d.status === 'pending' && (d.approvedAt || d.approvedBy || d.paymentApprovedAt)) {
            pendingWithApprovalData.push(doc.id);
        }
    }
    
    console.log(`Found ${approvedButPendingPayment.length} members who are approved but paymentStatus is pending.`);
    console.log(`Found ${pendingWithApprovalData.length} members who are pending but have approval fields.`);
}
main().catch(console.error);
