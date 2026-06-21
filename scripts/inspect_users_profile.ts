import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    const sampleIds = [
        '049LlSS28Tci2bg9iwktLDlJSeW2',
        '0EBTHLcaMGRktXzi7d28ubEHmK42',
        '0GL8DgnDKiMtz45CW4BnUrcULNI2',
        '0Ib0sA8mkjbrBwJncKaKnn9wXrq1',
        '0KufAcNl5KZwLstejLapPbF2xsV2'
    ];

    for (const uid of sampleIds) {
        console.log(`\n=========================================`);
        console.log(`User: ${uid}`);
        console.log(`=========================================`);

        const userDoc = await db.collection("users").doc(uid).get();
        if (userDoc.exists) {
            console.log("User doc data:");
            console.log(JSON.stringify(userDoc.data(), null, 2));
        } else {
            console.log("User document NOT FOUND in users collection");
        }

        const memberDoc = await db.collection("cooperative_members").doc(uid).get();
        if (memberDoc.exists) {
            console.log("\nMember doc data:");
            console.log(JSON.stringify(memberDoc.data(), null, 2));
        } else {
            console.log("Member document NOT FOUND in cooperative_members collection");
        }
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
