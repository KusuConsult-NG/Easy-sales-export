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
    console.log("Deleting falsely generated applications...");
    const membersSnap = await db.collection("cooperative_members").get();
    
    let batch = db.batch();
    let count = 0;
    
    for (let doc of membersSnap.docs) {
        const d = doc.data();
        if (d.metadata?.reason === "Recovered from orphan payment record") {
            batch.delete(doc.ref);
            count++;
        }
    }
    
    if (count > 0) {
        await batch.commit();
        console.log(`Successfully deleted ${count} falsely generated applications.`);
    } else {
        console.log("No falsely generated applications found.");
    }
}
main().catch(console.error);
