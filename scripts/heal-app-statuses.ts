import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { invalidateUserCache } from "../src/lib/cache-invalidation";

async function healApplicationStatuses() {
    console.log("Starting resilient application status healing for paid/approved users...");
    
    // 1. Pre-load all users to check service registrations and roles
    console.log("Pre-loading users...");
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    const usersMap = new Map<string, any>();
    usersSnap.docs.forEach(doc => {
        usersMap.set(doc.id, doc.data());
    });
    console.log(`Loaded ${usersMap.size} users.`);

    let batch = db.batch();
    let updates = 0;
    const modifiedUserIds = new Set<string>();

    const collectionsToHeal = [
        { id: COLLECTIONS.COOPERATIVE_MEMBERS, module: "cooperative" },
        { id: COLLECTIONS.ACADEMY_APPLICATIONS, module: "academy" },
        { id: COLLECTIONS.WAVE_APPLICATIONS, module: "wave" },
        { id: COLLECTIONS.EXPORT_APPLICATIONS, module: "export" },
        { id: COLLECTIONS.FARM_NATION_APPLICATIONS, module: "farmNation" }
    ];

    for (const item of collectionsToHeal) {
        const collection = item.id;
        const moduleKey = item.module;
        console.log(`\nChecking collection: ${collection}...`);
        
        const snap = await db.collection(collection).get();
        console.log(`Found ${snap.size} documents in ${collection}.`);

        for (const doc of snap.docs) {
            const data = doc.data();
            
            // Resolve userId safely
            let userId = data.userId || "";
            if (!userId) {
                if (doc.id.startsWith("legacy_")) {
                    userId = doc.id.replace("legacy_", "");
                } else if (doc.id.length >= 20 && !doc.id.includes("@")) {
                    userId = doc.id;
                }
            }

            if (!userId) continue;

            const userDoc = usersMap.get(userId);
            const serviceRegs = userDoc?.serviceRegistrations || {};
            
            // Map module key to potential variations stored in serviceRegistrations
            const moduleReg = serviceRegs[moduleKey] || 
                            serviceRegs[moduleKey === "farmNation" ? "farm_nation" : 
                                        moduleKey === "cooperative" ? "cooperatives" : ""] || {};

            // Determine if this document represents a paid, approved, or role-granted service enrollment
            const isPaidInApp = data.paymentStatus === "completed" || data.paymentStatus === "paid" || data.paid === true;
            const isPaidInUser = moduleReg.paymentStatus === "completed" || moduleReg.status === "approved" || moduleReg.status === "active";
            const hasUserRole = userDoc?.roles?.includes(
                moduleKey === "cooperative" ? "cooperative_member" :
                moduleKey === "academy" ? "academy_participant" :
                moduleKey === "wave" ? "wave_participant" :
                moduleKey === "export" ? "export_participant" :
                moduleKey === "farmNation" ? "farmer" : ""
            );

            const isEligibleForHealing = isPaidInApp || isPaidInUser || hasUserRole;

            if (!isEligibleForHealing) continue;

            let needsUpdate = false;
            const updateData: any = {
                updatedAt: new Date()
            };
            
            if (collection === COLLECTIONS.COOPERATIVE_MEMBERS) {
                // Cooperative members should be active/active/completed
                const currentStatus = data.status || "pending";
                const currentMemberStatus = data.membershipStatus || "pending";
                
                if (currentStatus !== "active" || currentMemberStatus !== "active") {
                    needsUpdate = true;
                    updateData.status = "active";
                    updateData.membershipStatus = "active";
                    
                    if (data.paymentStatus !== "completed") {
                        updateData.paymentStatus = "completed";
                    }
                }
            } else {
                // Other applications should be status: approved
                const currentStatus = data.status || "pending";
                if (currentStatus !== "approved") {
                    needsUpdate = true;
                    updateData.status = "approved";
                    
                    // Populate paymentStatus only for paid applications
                    if (moduleKey === "academy" || moduleKey === "wave") {
                        if (data.paymentStatus !== "completed" && data.paymentStatus !== "paid") {
                            updateData.paymentStatus = "completed";
                        }
                    }
                }
            }

            if (needsUpdate) {
                batch.update(doc.ref, updateData);
                updates++;
                modifiedUserIds.add(userId);
                console.log(`[${collection}] Queued update for doc ${doc.id} (User ${userId}) -> ${JSON.stringify(updateData)}`);

                if (updates >= 450) {
                    await batch.commit();
                    batch = db.batch();
                    updates = 0;
                    console.log("Committed batch...");
                }
            }
        }
    }

    if (updates > 0) {
        await batch.commit();
        console.log("Committed final batch.");
    }
    
    console.log(`\nStatus heal complete! Firestore updated for ${modifiedUserIds.size} users.`);

    // 2. Perform Redis invalidation for all healed users
    if (modifiedUserIds.size > 0) {
        console.log(`Invalidating Upstash Redis cache for ${modifiedUserIds.size} users...`);
        for (const userId of modifiedUserIds) {
            await invalidateUserCache(userId);
        }
        console.log("Redis cache invalidation complete.");
    }
}

healApplicationStatuses().catch(console.error);
