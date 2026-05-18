import { db } from "../src/lib/firebase-admin";

async function listUsers() {
    console.log("Listing all Firestore user profiles...");
    try {
        const snapshot = await db.collection("users").get();
        console.log(`Found ${snapshot.size} user documents.`);
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`- UID: ${doc.id}`);
            console.log(`  Email: ${data.email}`);
            console.log(`  FullName: ${data.fullName || data.displayName || "(no name)"}`);
            console.log(`  Roles: ${JSON.stringify(data.roles || [])}`);
            console.log(`  isActive: ${data.isActive}`);
            console.log(`  Status: ${data.status}`);
            console.log("------------------------------------------");
        });
    } catch (e: any) {
        console.error("Error reading Firestore:", e.message);
    }
}

listUsers();
