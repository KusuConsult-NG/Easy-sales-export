import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const coopSnap = await db.collection("cooperative_members").get();
    
    let activeLegacyCount = 0;
    let pendingLegacyCount = 0;
    let activeManualCount = 0;
    let activeCSVCount = 0;
    
    coopSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.membershipStatus || data.status || "";
        const isActive = (status === "active" || status === "approved");
        
        const isLegacy = data._importSource === "legacy_csv_import" || data.importSource === "legacy_csv_import";
        
        if (isLegacy) {
            if (isActive) {
                activeLegacyCount++;
            } else {
                pendingLegacyCount++;
            }
        }
        
        if (isActive) {
            if (data.approvedBy || data.approvedAt) {
                activeManualCount++;
            } else {
                activeCSVCount++;
            }
        }
    });
    
    console.log(`=== Legacy Member Import Stats ===`);
    console.log(`Active Legacy Members: ${activeLegacyCount}`);
    console.log(`Pending Legacy Members: ${pendingLegacyCount}`);
    console.log(`\n=== Active Member Stats ===`);
    console.log(`Total Active: ${activeLegacyCount + activeManualCount + (activeCSVCount - activeLegacyCount)} (should be 773)`);
    console.log(`  - Manually Approved: ${activeManualCount}`);
    console.log(`  - Legacy Active: ${activeLegacyCount}`);
    console.log(`  - Other CSV/Active: ${activeCSVCount - activeLegacyCount}`);
}

main().catch(console.error).finally(() => process.exit(0));
