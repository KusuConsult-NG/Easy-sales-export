import { getAdminDb } from "./src/lib/firebase-admin";

async function run() {
    const db = getAdminDb();
    const snap = await db.collection("users").where("roles", "array-contains", "seller").get();
    
    let sellerOnly = 0;
    let both = 0;
    snap.docs.forEach(doc => {
        const data = doc.data();
        const roles = data.roles || [];
        const hasBuyer = roles.includes("buyer") || roles.includes("marketplace_buyer");
        if (hasBuyer) both++; else sellerOnly++;
    });
    console.log(`Found ${snap.size} sellers. ${sellerOnly} are ONLY sellers. ${both} have buyer roles too.`);
    process.exit(0);
}
run().catch(console.error);
