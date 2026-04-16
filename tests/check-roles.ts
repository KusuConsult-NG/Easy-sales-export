import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    }),
});

async function check() {
    const db = getFirestore();
    const snap = await db.collection("users").where("email", "==", "steviekusu@gmail.com").get();
    if (snap.empty) {
        console.log("Not found.");
        return;
    }
    const doc = snap.docs[0].data();
    console.log(`Roles for ${doc.email}:`);
    console.log(doc.roles);
    console.log(`Full Doc:`, doc);
}
check().catch(console.error);
