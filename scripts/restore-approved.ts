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
    const snap = await db.collection("cooperative_members").get();
    
    let batch = db.batch();
    let updates = 0;
    
    snap.docs.forEach(doc => {
        const d = doc.data();
        // If they have a valid audit trail of being manually approved
        if (d.approvedAt || d.approvedBy) {
            // And their status is currently pending
            if (d.status === 'pending' || d.membershipStatus === 'pending') {
                batch.update(doc.ref, {
                    status: "approved",
                    membershipStatus: "approved"
                });
                updates++;
            }
        }
    });

    if (updates > 0) {
        await batch.commit();
        console.log(`Successfully restored ${updates} users to approved status.`);
    } else {
        console.log("No users found to restore.");
    }
}
main().catch(console.error);
