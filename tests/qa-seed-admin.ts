import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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

async function seedAdmin() {
    const auth = getAuth();
    const db = getFirestore();
    const email = "qa_audit_admin@easysalesexport.com";
    const password = "QA_Password_123!!";
    
    let uid;
    try {
        const user = await auth.getUserByEmail(email);
        uid = user.uid;
        await auth.updateUser(uid, { password: password });
        console.log(`Updated existing user: ${uid}`);
    } catch (e: any) {
        if (e.code === 'auth/user-not-found') {
            const user = await auth.createUser({
                email,
                password,
                emailVerified: true,
                displayName: "QA System Auditor"
            });
            uid = user.uid;
            console.log(`Created new user: ${uid}`);
        } else {
            throw e;
        }
    }
    
    await db.collection("users").doc(uid).set({
        email,
        fullName: "QA System Auditor",
        roles: ["super_admin"],
        createdAt: new Date(),
        updatedAt: new Date(),
        verified: true,
        status: "active"
    }, { merge: true });
    
    console.log("Admin Seeding Complete. You can log in with:");
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
}

seedAdmin().catch(console.error);
