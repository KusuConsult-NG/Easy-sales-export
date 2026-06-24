import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Checking wave_applications count...");
    const snap = await db.collection("wave_applications").count().get();
    console.log("Count:", snap.data().count);
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
