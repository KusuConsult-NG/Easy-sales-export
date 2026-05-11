
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { categorizeUser } from "../src/lib/broadcast-logic";

async function calculateSegmentation() {
    console.log("📊 Calculating User Segmentation (Standardized logic)...");
    
    const segments: Record<string, number> = {
        active_users: 0,
        pending_users: 0,
        stalled_users: 0,
        ghost_users: 0
    };

    let totalAccounts = 0;

    // Use stream to handle 37k+ users without memory overflow
    await new Promise((resolve, reject) => {
        db.collection(COLLECTIONS.USERS).stream()
            .on("data", (doc) => {
                totalAccounts++;
                const data = doc.data();
                const segment = categorizeUser(data);
                segments[segment] = (segments[segment] || 0) + 1;
            })
            .on("end", resolve)
            .on("error", reject);
    });

    console.log("\n--- USER SEGMENTATION BREAKDOWN ---");
    console.log(`Total Unique Accounts: ${totalAccounts}`);
    console.log("");
    
    Object.entries(segments).forEach(([key, value]) => {
        const percentage = ((value / totalAccounts) * 100).toFixed(1);
        console.log(`${key.replace(/_/g, ' ').toUpperCase()}: ${value} (${percentage}%)`);
    });
}

calculateSegmentation().catch(console.error);
