import * as dotenv from 'dotenv';
import * as path from 'path';

// Load the root .env.local completely
const rootEnvPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: rootEnvPath });

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY as string;
    if (privateKey && privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }
    if (privateKey && privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        })
    });
}
const db = getFirestore();

async function checkCentralPhones() {
    const snapshot = await db.collection("cooperative_members").get();
    
    let hasPhoneCount = 0;
    
    for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = data.userId;
        if (!userId) continue;
        
        const userSnap = await db.collection("users").doc(userId).get();
        if (userSnap.exists) {
            const userData = userSnap.data();
            if (userData?.phone) {
                hasPhoneCount++;
            }
        }
    }
    
    console.log(`Out of ${snapshot.docs.length} cooperative members, ${hasPhoneCount} already have a phone number in their central 'users' profile.`);
    process.exit(0);
}

checkCentralPhones().catch(console.error);
