import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

async function main() {
    const toggles = ["wallet_deposits", "wallet_withdrawals"];

    for (const toggle of toggles) {
        console.log(`Setting feature toggle '${toggle}' to disabled (enabled = false) in database...`);
        const docRef = db.collection(COLLECTIONS.FEATURE_TOGGLES).doc(toggle);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            await docRef.update({
                enabled: false,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: "system_admin_block"
            });
            console.log(`Updated '${toggle}' to enabled: false`);
        } else {
            await docRef.set({
                id: toggle,
                name: toggle === "wallet_deposits" ? "Wallet Deposits" : "Wallet Withdrawals",
                description: toggle === "wallet_deposits" ? "Allow users to deposit funds into their marketplace wallet" : "Allow users to withdraw funds from their marketplace wallet",
                enabled: false,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                createdBy: "system_admin_block"
            });
            console.log(`Created and set '${toggle}' to enabled: false`);
        }
    }

    console.log("Feature toggles updated successfully.");
}

main().catch(console.error);
