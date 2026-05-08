import { getAdminDb } from "./src/lib/firebase-admin";

async function run() {
    const db = getAdminDb();
    const snapshot = await db.collection("users").get();
    
    let noEmail = 0;
    const emails = new Set();
    let dups = 0;
    const dupList: string[] = [];

    snapshot.docs.forEach(doc => {
        const d = doc.data();
        const raw = d.email || d.userEmail || "";
        const e = raw.toLowerCase().trim();
        
        if (!e) {
            noEmail++;
        } else {
            if (emails.has(e)) {
                dups++;
                dupList.push(`${e} (Doc ID: ${doc.id})`);
            } else {
                emails.add(e);
            }
        }
    });

    console.log("Total Registered Accounts (Docs):", snapshot.size);
    console.log("Unique Recipients Identified:", emails.size);
    console.log("-------------------------------------------");
    console.log("Disparity Count:", snapshot.size - emails.size);
    console.log("-------------------------------------------");
    console.log("REASONS FOR EXCLUSION:");
    console.log(`1. Missing/Empty Email Field: ${noEmail} users`);
    console.log(`2. Duplicate Email Addresses: ${dups} users (merged)`);
    
    if (dupList.length > 0) {
        console.log("\nSample Duplicates:");
        console.log(dupList.slice(0, 5));
    }
}

run().catch(console.error);
