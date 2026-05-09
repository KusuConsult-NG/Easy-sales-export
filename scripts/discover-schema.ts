
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function discover() {
    console.log("🔍 Starting Aggressive Schema Discovery (V2)...");

    // Sample users with N/A
    const usersSnap = await db.collection(COLLECTIONS.USERS)
        .where("verificationProfile.bankDetails.bankName", "==", "N/A")
        .limit(10)
        .get();

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const uData = userDoc.data();
        const email = uData.email;

        console.log(`\n--- [${userId}] ${email} ---`);
        console.log("Root Doc Keys:", Object.keys(uData));

        // 1. Search WAVE by email
        const waveByEmail = await db.collection("wave_applications").where("userEmail", "==", email).get();
        if (!waveByEmail.empty) {
            console.log("WAVE Found by Email:", JSON.stringify(waveByEmail.docs[0].data(), null, 2));
        }

        // 2. Search Sellers by email
        const sellerByEmail = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("email", "==", email).get();
        if (!sellerByEmail.empty) {
            console.log("Seller Found by Email:", JSON.stringify(sellerByEmail.docs[0].data(), null, 2));
        }

        // 3. Search Cooperative by email
        const coopByEmail = await db.collection("cooperative_members").where("personalInfo.email", "==", email).get();
        if (!coopByEmail.empty) {
            console.log("Coop Found by Email:", JSON.stringify(coopByEmail.docs[0].data(), null, 2));
        }

        // 4. Check for "snake_case" fields in root doc
        if (uData.bank_name || uData.account_number || uData.state_of_origin) {
            console.log("Snake Case Fields found in root!");
        }
    }
}

discover().catch(console.error);
