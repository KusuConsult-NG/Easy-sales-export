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
    
    let hasApprovedAt = 0;
    let hasApprovedBy = 0;
    let hasBoth = 0;
    let hasEitherButPending = 0;
    let hasEitherButActive = 0;

    snap.docs.forEach(doc => {
        const d = doc.data();
        const hasTime = !!d.approvedAt;
        const hasAdmin = !!d.approvedBy;
        
        if (hasTime) hasApprovedAt++;
        if (hasAdmin) hasApprovedBy++;
        if (hasTime && hasAdmin) hasBoth++;
        
        if (hasTime || hasAdmin) {
            if (d.status === 'pending' || d.membershipStatus === 'pending') {
                hasEitherButPending++;
            } else if (d.status === 'approved' || d.status === 'active' || d.membershipStatus === 'approved' || d.membershipStatus === 'active') {
                hasEitherButActive++;
            }
        }
    });

    console.log({
        hasApprovedAt,
        hasApprovedBy,
        hasBoth,
        hasEitherButPending,
        hasEitherButActive
    });
}
main().catch(console.error);
