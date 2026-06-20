import { db } from "../src/lib/firebase-admin";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.production.local") });

async function main() {
    console.log("Fetching flash_sale_products from Firestore...");
    const snap = await db.collection("flash_sale_products").get();
    console.log(`Found ${snap.docs.length} documents.`);
    for (const doc of snap.docs) {
        console.log(`- Document ID: ${doc.id}`);
        console.log(JSON.stringify(doc.data(), null, 2));
    }
}

main().catch(console.error);
