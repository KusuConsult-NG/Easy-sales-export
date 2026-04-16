import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, cert } from "firebase-admin/app";

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    }),
});

async function run() {
    console.log("Fetching metrics natively...");
    const db = getFirestore();
    const snap = await db.collection("users").count().get();
    console.log("Total Users (Native):", snap.data().count);
}

run().catch(console.error);
