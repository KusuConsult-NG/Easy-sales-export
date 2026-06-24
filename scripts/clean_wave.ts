import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { getAdminDb } from "../src/lib/firebase-admin";

async function main() {
    console.log("Starting bulk delete of notifications...");
    const db = getAdminDb();
    const collectionRef = db.collection("notifications");
    
    await db.recursiveDelete(collectionRef);
    console.log("Successfully cleared notifications collection!");
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Bulk delete failed:", err);
    process.exit(1);
});
