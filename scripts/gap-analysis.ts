
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";

async function getGapBreakdown() {
    console.log("🔍 Analyzing Onboarding Gaps...");
    
    const snapshot = await db.collection("users").get();
    
    let total = snapshot.size;
    let trueGhostUsers = 0; // No module registrations at all
    let stalledUsers = 0;   // Has at least one registration but missing Bank/Address
    let completeUsers = 0;  // Fully onboarded

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const regs = data.serviceRegistrations || {};
        
        // Has any module been started?
        const hasStartedAny = Object.values(regs).some((r: any) => r.status && r.status !== "not_started");
        
        // Is data complete?
        const hasBank = data.verificationProfile?.bankDetails?.bankName && data.verificationProfile?.bankDetails?.bankName !== "N/A";
        const hasAddress = data.verificationProfile?.address?.state && data.verificationProfile?.address?.state !== "N/A";
        
        if (!hasStartedAny) {
            trueGhostUsers++;
        } else if (!hasBank || !hasAddress) {
            stalledUsers++;
        } else {
            completeUsers++;
        }
    });

    console.log("\n=========================================");
    console.log("📊 ONBOARDING GAP ANALYSIS");
    console.log("=========================================");
    console.log(`Total Users:          ${total}`);
    console.log(`✅ Fully Onboarded:   ${completeUsers}`);
    console.log(`⚠️  Stalled (Started): ${stalledUsers}`);
    console.log(`👻 Ghost (No Start):  ${trueGhostUsers}`);
    console.log("=========================================\n");
}

getGapBreakdown().catch(console.error);
