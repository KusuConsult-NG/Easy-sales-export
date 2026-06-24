import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env.production.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    const disputesSnap = await db.collection("disputes").get();
    console.log(`Found ${disputesSnap.docs.length} disputes:`);
    for (const doc of disputesSnap.docs) {
        console.log(`Dispute ID: ${doc.id}`);
        console.log(JSON.stringify(doc.data(), null, 2));
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
