
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function calculateStats() {
    console.log("📊 Calculating Hybrid Module Registration Stats...");
    
    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    const accountsCount = snapshot.size;

    const stats = {
        wave_applications: (await db.collection(COLLECTIONS.WAVE_APPLICATIONS).count().get()).data().count,
        wave_briefings: (await db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS).count().get()).data().count,
        academy: 0,
        cooperatives: 0,
        cooperative_onboarding: (await db.collection(COLLECTIONS.COOPERATIVE_ONBOARDING).count().get()).data().count,
        farm_nation: 0,
        export_hub: 0,
        export_onboarding: (await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).count().get()).data().count,
        marketplace: 0
    };

    // Academy, Cooperatives, Farm Nation, and Marketplace often start in serviceRegistrations
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const regs = data.serviceRegistrations || {};
        const isStarted = (m: any) => m && m.status && m.status !== "not_started";

        if (isStarted(regs.academy)) stats.academy++;
        if (isStarted(regs.cooperative)) stats.cooperatives++;
        if (isStarted(regs.farm_nation) || isStarted(regs.farmNation)) stats.farm_nation++;
        if (isStarted(regs.marketplace)) stats.marketplace++;
        if (isStarted(regs.export)) stats.export_hub++;
    });

    const totalModuleRegs = Object.values(stats).reduce((a, b) => a + b, 0);

    console.log("\n--- FINAL REGISTRATIONS BY MODULE ---");
    console.log(`Total Module Registrations: ${totalModuleRegs}`);
    console.log(`Unique Accounts: ${accountsCount}`);
    console.log("");
    
    Object.entries(stats).forEach(([key, value]) => {
        const percentage = ((value / totalModuleRegs) * 100).toFixed(1);
        console.log(`${key.replace(/_/g, ' ').toUpperCase()}: ${value} (${percentage}%)`);
    });
}

calculateStats().catch(console.error);
