
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { normalizeUserProfile } from "../src/lib/canonical/normalizer";

/**
 * PLATFORM GOVERNANCE AUDIT TOOL
 * 
 * Scans for cross-module desynchronization and data drift.
 */

async function runAudit() {
    console.log("🔍 Starting Platform-Wide Governance Audit...");

    // 1. Load Sub-module Indices
    console.log("📂 Indexing sub-collections...");
    const sellers = new Map();
    const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).get();
    sellerSnap.docs.forEach(d => sellers.set(d.data().userId, d.data()));

    const members = new Map();
    const memberSnap = await db.collection("cooperative_members").get();
    memberSnap.docs.forEach(d => members.set(d.data().userId, d.data()));

    const waveApps = new Map();
    const waveSnap = await db.collection("wave_applications").get();
    waveSnap.docs.forEach(d => waveApps.set(d.data().userId, d.data()));

    console.log(`✅ Indices loaded: ${sellers.size} Sellers, ${members.size} Coop Members, ${waveApps.size} WAVE Apps.`);

    // 2. Scan Users
    let totalUsers = 0;
    let desyncedUsers = 0;
    const issues = {
        marketplace: 0,
        cooperative: 0,
        wave: 0,
        identity: 0
    };

    const userSnap = await db.collection(COLLECTIONS.USERS).get();
    totalUsers = userSnap.size;

    for (const doc of userSnap.docs) {
        const uData = doc.data();
        const userId = doc.id;
        
        let hasIssue = false;

        // Check Marketplace Sync
        const sData = sellers.get(userId);
        if (sData && (uData.sellerVerificationStatus !== sData.status)) {
            issues.marketplace++;
            hasIssue = true;
        }

        // Check Cooperative Sync
        const mData = members.get(userId);
        if (mData && (uData.serviceRegistrations?.cooperative?.status !== "active")) {
            issues.cooperative++;
            hasIssue = true;
        }

        // Check Identity Drifts
        if (!uData.fullName && (uData.firstName || uData.lastName)) {
            issues.identity++;
            hasIssue = true;
        }

        if (hasIssue) desyncedUsers++;
    }

    console.log("\n=========================================");
    console.log("🚩 AUDIT RESULTS");
    console.log("=========================================");
    console.log(`Total Unique Accounts: ${totalUsers}`);
    console.log(`Total Desynchronized Users: ${desyncedUsers} (${((desyncedUsers/totalUsers)*100).toFixed(1)}%)`);
    console.log("-----------------------------------------");
    console.log(`❌ Marketplace Drift: ${issues.marketplace}`);
    console.log(`❌ Cooperative Drift: ${issues.cooperative}`);
    console.log(`❌ WAVE Sync Failures: ${issues.wave}`);
    console.log(`❌ Identity Inconsistencies: ${issues.identity}`);
    console.log("=========================================");

    if (desyncedUsers > 0) {
        console.log("\n💡 Recommended Action: Run 'npm run repair:platform' to enforce canonical state.");
    }
}

runAudit().catch(console.error);
