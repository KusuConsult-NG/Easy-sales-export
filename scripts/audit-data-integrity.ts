
import * as dotenv from "dotenv";
import * as path from "path";

import * as fs from "fs";

// Load environment variables
const envFile = fs.existsSync(path.resolve(process.cwd(), ".env.production.local"))
    ? ".env.production.local"
    : ".env.local";
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { runScript } from "./_maintenance-guard";
// `import * as fs from "fs"` appeared twice in this file — once above the
// db import and once here — which is TS2300 twice over. Nobody ever saw it
// because scripts/ was excluded from tsconfig and eslint alike (#328).

export async function runAudit() {
    console.log("🚀 Starting Optimized Data Integrity Audit...");
    const stats = {
        totalSellersChecked: 0,
        missingBankInRoot: 0,
        missingBankInSeller: 0,
        missingDocsInSeller: 0,
        desyncedPhone: 0,
        desyncedState: 0,
        orphanedSellerVerifications: 0,
        usersWithMarketplaceButNoVerificationDoc: 0,
    };

    // 1. Audit Seller Verifications
    console.log("📁 Fetching Seller Verifications...");
    const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).limit(1000).get();
    stats.totalSellersChecked = sellerSnap.size;
    
    const userIds = [...new Set(sellerSnap.docs.map(d => d.data().userId).filter(Boolean))];
    console.log(`🔍 Checking ${userIds.length} unique users linked to ${sellerSnap.size} verifications...`);

    // Fetch users in chunks
    const userMap = new Map();
    for (let i = 0; i < userIds.length; i += 30) {
        const chunk = userIds.slice(i, i + 30);
        const usersSnap = await db.collection(COLLECTIONS.USERS).where("__name__", "in", chunk).get();
        usersSnap.forEach(d => userMap.set(d.id, d.data()));
        console.log(`   - Progress: ${i + chunk.length}/${userIds.length} users fetched`);
    }

    sellerSnap.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId;
        const uData = userMap.get(userId);

        if (!uData) {
            stats.orphanedSellerVerifications++;
            return;
        }

        // Check Bank Details
        const hasBankInSeller = !!(data.bankDetails?.accountNumber || data.accountNumber || data.bankAccount?.accountNumber);
        const hasBankInRoot = !!(uData.bankDetails?.accountNumber || uData.kyc?.bankDetails?.accountNumber);

        if (!hasBankInSeller) stats.missingBankInSeller++;
        if (!hasBankInRoot && hasBankInSeller) stats.missingBankInRoot++;

        // Check Documents
        const hasDocsInSeller = !!(data.documents?.businessDoc || data.documents?.idDoc || data.businessDoc || data.idDoc);
        if (!hasDocsInSeller) stats.missingDocsInSeller++;

        // Check Sync
        if (data.phone !== uData.phone) stats.desyncedPhone++;
        if (data.state !== uData.stateOfOrigin && data.state !== uData.kyc?.state && data.state !== uData.address?.state) stats.desyncedState++;
    });

    // 2. Audit Marketplace Status in Users
    console.log("📁 Auditing Marketplace Statuses in Users collection...");
    const marketUsersSnap = await db.collection(COLLECTIONS.USERS)
        .where("serviceRegistrations.marketplace.status", "in", ["active", "approved", "pending"])
        .limit(1000)
        .get();

    marketUsersSnap.docs.forEach(doc => {
        const uData = doc.data();
        const verificationId = uData.sellerVerificationId || uData.serviceRegistrations?.marketplace?.verificationId;
        if (!verificationId) {
            stats.usersWithMarketplaceButNoVerificationDoc++;
        }
    });

    console.log("\n📊 AUDIT RESULTS (1000 Sample):");
    console.table(stats);

    // THE REPORT WAS WRITTEN INTO A DIRECTORY THAT DOES NOT EXIST — #329.
    //
    // `artifacts/` is not in the repository and is not created by anything;
    // writeFileSync therefore threw ENOENT after the whole audit had run, and
    // the `.catch(console.error)` at the bottom logged it and exited 0. So the
    // audit did all its work, lost the report, and reported success.
    const reportDir = path.resolve(process.cwd(), "artifacts");
    fs.mkdirSync(reportDir, { recursive: true });

    const reportPath = path.join(reportDir, "audit_report_sample.json");
    fs.writeFileSync(reportPath, JSON.stringify({ stats, timestamp: new Date().toISOString() }, null, 2));
    console.log(`\n✅ Audit report saved to ${reportPath}`);
}

// `runAudit().catch(console.error)` exited 0 after a failed audit — #329. This
// script reads only, so there is no --apply gate; the exit code is the fix.
if (require.main === module) {
    runScript("Data integrity audit", runAudit);
}
