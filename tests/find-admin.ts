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

async function findAdmins() {
    const db = getFirestore();
    const usersSnap = await db.collection("users").where("roles", "array-contains", "super_admin").limit(1).get();
    if (usersSnap.empty) {
        console.log("NO_ADMINS_FOUND");
    } else {
        const user = usersSnap.docs[0].data();
        console.log(`ADMIN_FOUND|email:${user.email}|uid:${usersSnap.docs[0].id}|password:${user.passwordHash ? 'hashed' : 'none'}`);
    }
}
findAdmins().catch(console.error);
