import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing Firestore Collections...");

    // Get all root collections
    const collections = await db.listCollections();
    const collectionIds = collections.map(col => col.id);
    console.log("Root Collections in Firestore:", collectionIds);

    // Let's audit specific candidate collections
    const candidates = [
        "academy_applications",
        "academy_enrollments",
        "export_applications",
        "land_verifications",
        "processedPayments",
        "users"
    ];

    for (const id of candidates) {
        if (collectionIds.includes(id)) {
            const snap = await db.collection(id).limit(1).get();
            console.log(`\nCollection: ${id}`);
            console.log(`- Total (approx/size): ${snap.size > 0 ? 'exists (has data)' : 'empty'}`);
            if (snap.size > 0) {
                console.log(`- Sample Doc keys:`, Object.keys(snap.docs[0].data()));
            }
        } else {
            console.log(`\nCollection: ${id} (DOES NOT EXIST)`);
        }
    }
}

main().catch(err => {
    console.error(err);
});
