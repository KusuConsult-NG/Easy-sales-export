import { getAdminDb } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";

async function analyzeDisparity() {
    const db = getAdminDb();
    console.log("Starting analysis of USERS collection...");

    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    console.log(`Total documents in USERS collection: ${snapshot.size}`);

    let missingEmail = 0;
    let emptyEmail = 0;
    const emailCounts = new Map<string, number>();
    const missingDocs: string[] = [];

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const email = data.email || data.userEmail;

        if (!email) {
            missingEmail++;
            missingDocs.push(doc.id);
        } else if (email.trim() === "") {
            emptyEmail++;
            missingDocs.push(doc.id);
        } else {
            const norm = email.toLowerCase().trim();
            emailCounts.set(norm, (emailCounts.get(norm) || 0) + 1);
        }
    });

    let duplicates = 0;
    let duplicateEmails: string[] = [];
    emailCounts.forEach((count, email) => {
        if (count > 1) {
            duplicates += (count - 1);
            duplicateEmails.push(`${email} (${count} times)`);
        }
    });

    console.log("\n--- Disparity Report ---");
    console.log(`Total Docs: ${snapshot.size}`);
    console.log(`Docs with missing/null email: ${missingEmail}`);
    console.log(`Docs with empty string email: ${emptyEmail}`);
    console.log(`Total unique emails: ${emailCounts.size}`);
    console.log(`Total duplicates (merged): ${duplicates}`);
    console.log(`Calculated Recipients (Unique + Valid): ${emailCounts.size}`);
    
    console.log("\n--- Sample Missing IDs ---");
    console.log(missingDocs.slice(0, 5));

    console.log("\n--- Sample Duplicates ---");
    console.log(duplicateEmails.slice(0, 5));
}

analyzeDisparity().catch(console.error);
