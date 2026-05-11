
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function diagnostic() {
    console.log("🔍 Running Data Integrity Diagnostic...");
    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    
    let completedButNoBank = 0;
    let completedButNoAddress = 0;
    let notCompletedButHasBoth = 0;

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const hasBank = data.verificationProfile?.bankDetails?.bankName && data.verificationProfile?.bankDetails?.bankName !== "N/A";
        const hasAddress = data.verificationProfile?.address?.state && data.verificationProfile?.address?.state !== "N/A";
        const completed = data.onboardingCompleted === true;

        if (completed && !hasBank) completedButNoBank++;
        if (completed && !hasAddress) completedButNoAddress++;
        if (!completed && hasBank && hasAddress) notCompletedButHasBoth++;
    });

    console.log(`✅ Total Users Scanned: ${snapshot.size}`);
    console.log(`⚠️ Completed but No Bank: ${completedButNoBank}`);
    console.log(`⚠️ Completed but No Address: ${completedButNoAddress}`);
    console.log(`📝 Not Completed but Has Both: ${notCompletedButHasBoth}`);
}

diagnostic().catch(console.error);
