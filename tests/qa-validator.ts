import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";
import axios from "axios";

dotenv.config({ path: ".env.local" });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    }),
});

async function runQA() {
    console.log("Starting QA Validation (Direct DB Check)...");
    const db = getFirestore();
    
    // Check 1: Users
    const usersSnap = await db.collection("users").count().get();
    console.log(`[DB] Users: ${usersSnap.data().count}`);
    
    // Check 2: Transactions
    const txSnap = await db.collection("transactions").count().get();
    console.log(`[DB] Transactions: ${txSnap.data().count}`);
    
    // Check 3: Platform Settings
    const settingsSnap = await db.collection("settings").get();
    console.log(`[DB] Settings Docs: ${settingsSnap.size}`);
}

runQA().catch(console.error);
