import { getAdminDb } from "./src/lib/firebase-admin";

async function run() {
    const db = getAdminDb();
    const snap = await db.collection("users").where("roles", "array-contains-any", ["marketplace_buyer", "buyer", "seller", "marketplace_seller"]).get();
    
    console.log(`Found ${snap.size} total marketplace users`);
    process.exit(0);
}
run().catch(console.error);
