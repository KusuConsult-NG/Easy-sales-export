
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";

async function inspect() {
    const snap = await db.collection("USERS").where("verificationProfile.bankDetails.bankName", "==", "N/A").limit(1).get();
    if (!snap.empty) {
        console.log(JSON.stringify(snap.docs[0].data(), null, 2));
    } else {
        console.log("No N/A users found?!");
    }
}

inspect().catch(console.error);
