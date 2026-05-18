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
    
    let stats: Record<string, number> = {};
    let membershipStats: Record<string, number> = {};

    membersSnap.docs.forEach(doc => {
        const data = doc.data();
        
        const s = data.status || 'undefined';
        const ms = data.membershipStatus || 'undefined';
        
        stats[s] = (stats[s] || 0) + 1;
        membershipStats[ms] = (membershipStats[ms] || 0) + 1;
    });

    console.log("status:", stats);
    console.log("membershipStatus:", membershipStats);
}

main().catch(console.error);
