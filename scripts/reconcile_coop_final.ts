import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import { invalidateAdminGlobalStats, invalidateCooperativeCache } from "../src/lib/cache-invalidation";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
    console.log("=".repeat(60));
    console.log("COOPERATIVE FINAL RECONCILIATION SCRIPT");
    console.log(DRY_RUN ? "🔍 DRY RUN MODE — no database writes will be made" : "🔧 LIVE MODE — will modify database");
    console.log("=".repeat(60));

    // 1. Read CSV
    const csvPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("❌ CSV file not found at:", csvPath);
        process.exit(1);
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n");
    
    // Map of userId -> CSV status & details
    const csvMap = new Map<string, any>();
    for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i].trim();
        if (!line) continue;
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 8) {
            const userId = parts[0];
            csvMap.set(userId, {
                userId,
                firstName: parts[1],
                lastName: parts[2],
                email: parts[3],
                phone: parts[4],
                hasSubmitted: parts[5],
                hasPaid: parts[6],
                status: parts[7],
                ref: parts[8] || ""
            });
        }
    }
    console.log(`Loaded ${csvMap.size} users from reconciliation CSV.`);

    // 2. Fetch all members currently in Firestore
    console.log("Fetching cooperative_members from Firestore...");
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Loaded ${coopSnap.size} cooperative_members from Firestore.`);

    const activeUsersToSync = new Set<string>();
    const pendingUsersToSync = new Set<string>();

    let memberUpdatesCount = 0;
    let memberCreatesCount = 0;

    let batch = db.batch();
    let batchWritesCount = 0;

    const commitBatchIfNeeded = async () => {
        if (batchWritesCount >= 400) {
            if (!DRY_RUN) {
                await batch.commit();
                console.log(`  [Batch] Committed ${batchWritesCount} writes to Firestore.`);
            } else {
                console.log(`  [DRY] Would commit ${batchWritesCount} writes.`);
            }
            batch = db.batch();
            batchWritesCount = 0;
        }
    };

    // 3. Process existing members in Firestore
    for (const doc of coopSnap.docs) {
        const data = doc.data();
        const userId = data.userId || doc.id;
        const currentStatus = data.membershipStatus || data.status || "";
        const currentIsActive = (currentStatus === "active" || currentStatus === "approved");

        const isManual = data.approvedBy || data.approvedAt;
        const isHealed = data._system_healed || data.healedByScript || data._system_healed_recovery;
        
        const csvData = csvMap.get(userId);

        let targetStatus = "pending";

        if (isManual) {
            // Keep manually approved ones active
            targetStatus = "active";
            console.log(`  Manual approval: Keeping user ${userId} (${data.email || ""}) active.`);
        } else if (csvData && csvData.status === "active") {
            // Active in CSV -> Active
            targetStatus = "active";
        } else {
            // Healed/system-created or listed as pending/unsubmitted in CSV -> Pending
            targetStatus = "pending";
        }

        const targetIsActive = (targetStatus === "active");

        // Collect for User Doc sync
        if (targetIsActive) {
            activeUsersToSync.add(userId);
        } else {
            pendingUsersToSync.add(userId);
        }

        // Update member doc status if different
        if (currentStatus !== targetStatus || (targetIsActive && currentStatus === "approved")) {
            console.log(`  Member status change: User ${userId} | Current: ${currentStatus} -> Target: ${targetStatus}`);
            batch.update(doc.ref, {
                membershipStatus: targetStatus,
                status: targetStatus,
                updatedAt: new Date()
            });
            memberUpdatesCount++;
            batchWritesCount++;
            await commitBatchIfNeeded();
        }
    }

    // 4. Create missing active members from CSV
    const coopUserIds = new Set(coopSnap.docs.map(doc => doc.data().userId || doc.id));
    for (const [userId, csvData] of csvMap.entries()) {
        if (csvData.status === "active" && !coopUserIds.has(userId)) {
            console.log(`  Missing Active Member: Creating record for ${userId} (${csvData.email})`);
            
            // Try to load user document to get names/created dates if possible
            const userDoc = await db.collection("users").doc(userId).get();
            const uData = userDoc.exists ? userDoc.data() : null;

            const newApp = {
                userId: userId,
                email: csvData.email || uData?.email || "",
                firstName: csvData.firstName || uData?.firstName || "",
                lastName: csvData.lastName || uData?.lastName || "",
                phone: csvData.phone || uData?.phone || uData?.phoneNumber || "",
                status: "active",
                membershipStatus: "active",
                paymentStatus: csvData.hasPaid === "Yes" ? "completed" : "pending",
                paymentReference: csvData.ref || "",
                createdAt: uData?.createdAt || new Date(),
                updatedAt: new Date(),
                onboardingCompleted: true,
                _created_by_reconcile: true
            };

            const newDocRef = db.collection("cooperative_members").doc(userId);
            batch.set(newDocRef, newApp);
            activeUsersToSync.add(userId);
            memberCreatesCount++;
            batchWritesCount++;
            await commitBatchIfNeeded();
        }
    }

    // Process leftover batch writes for member docs
    if (batchWritesCount > 0) {
        if (!DRY_RUN) {
            await batch.commit();
            console.log(`  [Batch] Committed last ${batchWritesCount} member writes.`);
        } else {
            console.log(`  [DRY] Would commit last ${batchWritesCount} member writes.`);
        }
        batch = db.batch();
        batchWritesCount = 0;
    }

    // 5. Sync User Documents (Roles & serviceRegistrations)
    console.log(`\nSyncing Roles & Registrations for users...`);
    console.log(`- Active users to sync: ${activeUsersToSync.size}`);
    console.log(`- Pending users to sync: ${pendingUsersToSync.size}`);

    let userUpdatesCount = 0;

    // We only need to check and update user docs for users whose roles/status are changing or need enforcement.
    // To be safe and clean, we will fetch user docs and update them in batches.
    const allUsersToSync = [
        ...Array.from(activeUsersToSync).map(id => ({ id, targetActive: true })),
        ...Array.from(pendingUsersToSync).map(id => ({ id, targetActive: false }))
    ];

    // Split into chunks of 30 for 'in' queries, or fetch individually in parallel chunks of 100
    const fetchChunkSize = 100;
    for (let i = 0; i < allUsersToSync.length; i += fetchChunkSize) {
        const chunk = allUsersToSync.slice(i, i + fetchChunkSize);
        
        // Fetch user docs in parallel (safe, read-only)
        const userDocsResults = await Promise.all(chunk.map(async (item) => {
            const userRef = db.collection("users").doc(item.id);
            const userDoc = await userRef.get();
            return { item, userDoc, userRef };
        }));

        // Apply updates sequentially (safe, avoids batch race condition)
        for (const { item, userDoc, userRef } of userDocsResults) {
            if (userDoc.exists) {
                const uData = userDoc.data() || {};
                const currentRoles = uData.roles || [];
                const currentStatus = uData.serviceRegistrations?.cooperatives?.status || "";

                const needsRoleUpdate = item.targetActive 
                    ? !currentRoles.includes("cooperative_member") 
                    : currentRoles.includes("cooperative_member");

                const needsStatusUpdate = item.targetActive
                    ? (currentStatus !== "active")
                    : (currentStatus === "active" || currentStatus === "approved");

                if (needsRoleUpdate || needsStatusUpdate) {
                    const updateObj: any = {
                        updatedAt: new Date()
                    };

                    if (item.targetActive) {
                        updateObj.roles = FieldValue.arrayUnion("cooperative_member");
                        updateObj["serviceRegistrations.cooperative.status"] = "active";
                        updateObj["serviceRegistrations.cooperatives.status"] = "active";
                        updateObj["serviceRegistrations.cooperative.updatedAt"] = new Date();
                        updateObj["serviceRegistrations.cooperatives.updatedAt"] = new Date();
                    } else {
                        updateObj.roles = FieldValue.arrayRemove("cooperative_member");
                        updateObj["serviceRegistrations.cooperative.status"] = "pending";
                        updateObj["serviceRegistrations.cooperatives.status"] = "pending";
                        updateObj["serviceRegistrations.cooperative.updatedAt"] = new Date();
                        updateObj["serviceRegistrations.cooperatives.updatedAt"] = new Date();
                    }

                    batch.update(userRef, updateObj);
                    userUpdatesCount++;
                    batchWritesCount++;

                    // Limit batch size
                    if (batchWritesCount >= 400) {
                        if (!DRY_RUN) {
                            await batch.commit();
                            console.log(`  [Batch] Committed ${batchWritesCount} user updates.`);
                        } else {
                            console.log(`  [DRY] Would commit ${batchWritesCount} user updates.`);
                        }
                        batch = db.batch();
                        batchWritesCount = 0;
                    }
                }
            }
        }
    }

    // Process leftover user batch writes
    if (batchWritesCount > 0) {
        if (!DRY_RUN) {
            await batch.commit();
            console.log(`  [Batch] Committed last ${batchWritesCount} user updates.`);
        } else {
            console.log(`  [DRY] Would commit last ${batchWritesCount} user updates.`);
        }
    }

    // 6. Cache Invalidation
    if (!DRY_RUN) {
        console.log("\nInvalidating stats and cooperative caches...");
        try {
            await invalidateAdminGlobalStats();
            await invalidateCooperativeCache();
            console.log("✅ Caches invalidated successfully.");
        } catch (err: any) {
            console.warn("⚠️ Cache invalidation encountered an error:", err.message);
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log("RECONCILIATION SUMMARY");
    console.log(`- Member docs updated: ${memberUpdatesCount}`);
    console.log(`- Member docs created: ${memberCreatesCount}`);
    console.log(`- User profiles updated: ${userUpdatesCount}`);
    console.log("=".repeat(60));
}

main().catch(console.error).finally(() => process.exit(0));
