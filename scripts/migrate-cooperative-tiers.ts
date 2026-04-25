import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";

// Load env vars
dotenv.config({ path: ".env.local" });

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
            privateKey: (process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY)?.replace(/\\n/g, "\n"),
        }),
    });
}

const db = getFirestore();

async function migrateTiers() {
    console.log("Starting cooperative tier migration...");

    try {
        const membersRef = db.collection("cooperative_members");
        const snapshot = await membersRef.get();

        let updatedCount = 0;
        let skippedCount = 0;

        let batch = db.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const currentTier = data.membershipTier;

            // Normalize "basic" or "premium" to "Member"
            if (
                currentTier &&
                (currentTier.toLowerCase() === "basic" ||
                    currentTier.toLowerCase() === "premium" ||
                    currentTier.toLowerCase() === "standard")
            ) {
                batch.update(doc.ref, { membershipTier: "Member" });
                updatedCount++;
                batchCount++;
                
                if (batchCount === 500) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                    console.log(`Committed batch of 500 updates...`);
                }
            } else {
                skippedCount++;
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        console.log("Migration Complete.");
        console.log(`Updated: ${updatedCount} records.`);
        console.log(`Skipped: ${skippedCount} records.`);
    } catch (error) {
        console.error("Migration failed:", error);
    }
}

migrateTiers();
