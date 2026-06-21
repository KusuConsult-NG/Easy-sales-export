import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("=========================================");
    console.log("INSPECTING WAVE_APPLICATIONS COLLECTION");
    console.log("=========================================");

    const appsSnap = await db.collection("wave_applications").get();
    console.log(`Total documents: ${appsSnap.size}`);

    appsSnap.docs.forEach((doc, idx) => {
        const data = doc.data();
        console.log(`\n[${idx + 1}] Document ID: ${doc.id}`);
        console.log(`  userId: ${data.userId || "N/A"}`);
        console.log(`  email: ${data.email || data.userEmail || "N/A"}`);
        console.log(`  fullName: ${[data.firstName, data.otherNames, data.surname].filter(Boolean).join(" ") || data.fullName || "N/A"}`);
        console.log(`  status: ${data.status || "N/A"}`);
        console.log(`  createdAt: ${data.createdAt?.toDate?.()?.toISOString() || data.createdAt}`);
    });
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
