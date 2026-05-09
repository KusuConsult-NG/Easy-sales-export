
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

/**
 * MISSING DATA AUDIT (V1)
 * 
 * Specifically targets the "N/A" artifacts reported in Address, State, LGA, and Bank Details.
 */

async function runMissingDataAudit() {
    console.log("🔍 Starting Deep Missing Data Audit...");

    const stats = {
        totalUsers: 0,
        missingBankName: 0,
        missingAccountNumber: 0,
        missingAccountName: 0,
        missingAddress: 0,
        missingState: 0,
        missingLGA: 0,
        missingNIN: 0,
        missingBVN: 0,
        orphans: [] as string[]
    };

    console.log("📂 Fetching all users...");
    const userSnap = await db.collection(COLLECTIONS.USERS).get();
    stats.totalUsers = userSnap.size;

    for (const doc of userSnap.docs) {
        const uData = doc.data();
        // Check Bank Details (Top level preferred)
        const bank = uData.bankDetails || uData.verificationProfile?.bankDetails;
        if (!bank?.bankName || bank?.bankName === "N/A") stats.missingBankName++;
        if (!bank?.accountNumber || bank?.accountNumber === "N/A") stats.missingAccountNumber++;
        if (!bank?.accountName || bank?.accountName === "N/A") stats.missingAccountName++;

        // Check Address Details (Top level preferred)
        const addr = uData.address || uData.verificationProfile?.address;
        if (!addr?.street || addr?.street === "N/A") stats.missingAddress++;
        if (!addr?.state || addr?.state === "N/A") stats.missingState++;
        if (!addr?.lga || addr?.lga === "N/A") stats.missingLGA++;

        // Check Identity
        const nin = uData.nin || uData.verificationProfile?.nin;
        const bvn = uData.bvn || uData.verificationProfile?.bvn;
        if (!nin || nin === "") stats.missingNIN++;
        if (!bvn || bvn === "") stats.missingBVN++;

        // Identify if they have module registrations but missing critical data
        const hasModule = uData.serviceRegistrations?.wave?.status !== "not_started" || 
                          uData.serviceRegistrations?.cooperative?.status !== "not_started" ||
                          uData.serviceRegistrations?.marketplace?.status !== "not_started";
        
        if (hasModule && (!bank?.accountNumber || bank?.accountNumber === "N/A")) {
            stats.orphans.push(`${uData.email || doc.id} (Missing Bank)`);
        }
    }

    console.log("\n=========================================");
    console.log("🚩 MISSING DATA AUDIT RESULTS");
    console.log("=========================================");
    console.log(`Total Users Scanned: ${stats.totalUsers}`);
    console.log("-----------------------------------------");
    console.log(`❌ Missing Bank Name:     ${stats.missingBankName}`);
    console.log(`❌ Missing Account No:   ${stats.missingAccountNumber}`);
    console.log(`❌ Missing Account Name: ${stats.missingAccountName}`);
    console.log("-----------------------------------------");
    console.log(`❌ Missing Address:      ${stats.missingAddress}`);
    console.log(`❌ Missing State:        ${stats.missingState}`);
    console.log(`❌ Missing LGA:          ${stats.missingLGA}`);
    console.log("-----------------------------------------");
    console.log(`❌ Missing NIN:          ${stats.missingNIN}`);
    console.log(`❌ Missing BVN:          ${stats.missingBVN}`);
    console.log("=========================================");

    if (stats.orphans.length > 0) {
        console.log(`\n⚠️ Found ${stats.orphans.length} active users with missing critical data.`);
        console.log("Top 5 examples:");
        stats.orphans.slice(0, 5).forEach(o => console.log(` - ${o}`));
    }

    console.log("\n💡 Recommended Action: Run 'npx tsx scripts/repair-platform.ts' to synchronize data.");
}

runMissingDataAudit().catch(console.error);
