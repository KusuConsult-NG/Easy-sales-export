import * as dotenv from 'dotenv';
import * as path from 'path';

// Load the root .env.local completely
const rootEnvPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: rootEnvPath });

console.log("Environment Project ID:", process.env.FIREBASE_PROJECT_ID);

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY as string;
    
    // Remove surrounding quotes if present
    if (privateKey && privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }

    // Handle escaped newlines (common in quoted env vars)
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

async function backfill() {
    console.log("Starting backfill for cooperative member profiles...");
    
    // Get all cooperative members
    const snapshot = await db.collection("cooperative_members").get();
    console.log(`Found ${snapshot.docs.length} cooperative members`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    let missingPhoneCount = 0;
    let missingUserCount = 0;
    
    const batchArray: any[] = [];
    let currentBatch = db.batch();
    let currentBatchSize = 0;
    
    // We fetch user documents individually to avoid updating non-existent ones,
    // though db.batch().set(ref, data, { merge: true }) works safely.
    // For update() to not throw, the document MUST exist.
    // So we use .set({ ... }, { merge: true }) instead to prevent 'No document to update' errors.
    
    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.phone) {
            const userId = data.userId;
            if (!userId) {
                skippedCount++;
                continue;
            }
            
            const userRef = db.collection("users").doc(userId);
            
            const updatePayload: any = {
                phone: data.phone,
                updatedAt: new Date()
            };
            if (data.gender) updatePayload.gender = data.gender;
            
            // Nested maps can't be deep merged perfectly with single line .set({ merge: true }) 
            // if we are using dot notation, but let's try reading the user first.
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                missingUserCount++;
                continue; // Cannot backfill details for a deleted user
            }
            
            const dotNotationUpdate: any = {
                phone: data.phone,
                updatedAt: new Date()
            };
            if (data.gender) dotNotationUpdate.gender = data.gender;
            if (data.stateOfOrigin) dotNotationUpdate["address.state"] = data.stateOfOrigin;
            if (data.lga) dotNotationUpdate["address.lga"] = data.lga;
            if (data.residentialAddress) dotNotationUpdate["address.street"] = data.residentialAddress;
            
            // update() requires the doc to exist
            currentBatch.update(userRef, dotNotationUpdate);
            currentBatchSize++;
            updatedCount++;
            
            if (currentBatchSize >= 450) {
                batchArray.push(currentBatch.commit());
                currentBatch = db.batch();
                currentBatchSize = 0;
            }
        } else {
            missingPhoneCount++;
        }
    }
    
    if (currentBatchSize > 0) {
        batchArray.push(currentBatch.commit());
    }
    
    await Promise.all(batchArray);
    
    console.log("====================");
    console.log(`Backfill Complete!`);
    console.log(`Total cooperative members checked: ${snapshot.docs.length}`);
    console.log(`Total central users updated: ${updatedCount}`);
    console.log(`Members missing phone numbers: ${missingPhoneCount}`);
    console.log(`Orphaned members/Missing Users: ${missingUserCount}`);
    console.log("====================");
    
    process.exit(0);
}

backfill().catch(console.error);
