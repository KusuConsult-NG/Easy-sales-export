import { config } from "dotenv";
config({ path: ".env.local" });
import { db, auth } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function globalStateSync() {
    console.log("Starting Global State Sync...");

    // 1. Fetch ALL users
    console.log("Fetching users...");
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    const usersMap = new Map<string, any>();
    usersSnap.docs.forEach(doc => {
        usersMap.set(doc.id, doc.data());
    });
    console.log(`Loaded ${usersMap.size} users.`);

    // 2. Initialize tracking maps
    const updatesMap = new Map<string, any>();
    const rolesToAddMap = new Map<string, Set<string>>();

    const getUpdates = (userId: string) => {
        if (!updatesMap.has(userId)) updatesMap.set(userId, {});
        return updatesMap.get(userId);
    };

    const addRole = (userId: string, role: string) => {
        if (!rolesToAddMap.has(userId)) rolesToAddMap.set(userId, new Set());
        rolesToAddMap.get(userId)!.add(role);
    };

    // 3. Process Cooperative Members
    console.log("Fetching Cooperative Members...");
    const coopSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get();
    coopSnap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.userId) return;
        const up = getUpdates(data.userId);
        if (!up.serviceRegistrations) up.serviceRegistrations = {};
        if (!up.serviceRegistrations.cooperatives) up.serviceRegistrations.cooperatives = {};
        
        up.serviceRegistrations.cooperatives.paymentStatus = data.paymentStatus || "pending";
        up.serviceRegistrations.cooperatives.status = data.membershipStatus || "pending";
        up.serviceRegistrations.cooperatives.updatedAt = new Date();

        if (data.paymentStatus === "completed" || data.membershipStatus === "active" || data.membershipStatus === "approved") {
            addRole(data.userId, "cooperative_member");
        }
    });

    // 4. Process Academy Applications
    console.log("Fetching Academy Applications...");
    const academySnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).get();
    academySnap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.userId) return;
        const up = getUpdates(data.userId);
        if (!up.serviceRegistrations) up.serviceRegistrations = {};
        if (!up.serviceRegistrations.academy) up.serviceRegistrations.academy = {};
        
        up.serviceRegistrations.academy.paymentStatus = data.paymentStatus || "pending";
        up.serviceRegistrations.academy.status = data.status || "pending";
        up.serviceRegistrations.academy.plan = data.plan || "foundation";
        up.serviceRegistrations.academy.updatedAt = new Date();

        if (data.paymentStatus === "completed" || data.status === "approved") {
            addRole(data.userId, "academy_participant");
        }
    });

    // 5. Process WAVE Applications
    console.log("Fetching WAVE Applications...");
    const waveSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).get();
    waveSnap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.userId) return;
        const up = getUpdates(data.userId);
        if (!up.serviceRegistrations) up.serviceRegistrations = {};
        if (!up.serviceRegistrations.wave) up.serviceRegistrations.wave = {};
        
        up.serviceRegistrations.wave.paymentStatus = data.paymentStatus || "pending";
        up.serviceRegistrations.wave.status = data.status || "pending";
        up.serviceRegistrations.wave.updatedAt = new Date();

        if (data.paymentStatus === "completed" || data.paymentStatus === "exempted" || data.status === "approved") {
            addRole(data.userId, "wave_participant");
        }
    });

    // 6. Process Farm Nation Applications
    console.log("Fetching Farm Nation Applications...");
    const farmSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).get();
    farmSnap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.userId) return;
        const up = getUpdates(data.userId);
        if (!up.serviceRegistrations) up.serviceRegistrations = {};
        if (!up.serviceRegistrations.farmNation) up.serviceRegistrations.farmNation = {};
        
        // Farm Nation doesn't usually use paymentStatus at application, just status
        up.serviceRegistrations.farmNation.status = data.status || "pending";
        up.serviceRegistrations.farmNation.updatedAt = new Date();

        if (data.status === "approved") {
            addRole(data.userId, "farmer"); // Using farmer as role or farm_nation_member? 'farmer' or 'land_owner'
            // In roles.ts it is 'farmer' and 'land_owner'
        }
    });

    // 7. Process Export Applications
    console.log("Fetching Export Applications...");
    const exportSnap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS).get();
    exportSnap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.userId) return;
        const up = getUpdates(data.userId);
        if (!up.serviceRegistrations) up.serviceRegistrations = {};
        if (!up.serviceRegistrations.export) up.serviceRegistrations.export = {};
        
        up.serviceRegistrations.export.paymentStatus = data.paymentStatus || "pending";
        up.serviceRegistrations.export.status = data.status || "pending";
        up.serviceRegistrations.export.updatedAt = new Date();

        if (data.paymentStatus === "completed" || data.status === "approved") {
            addRole(data.userId, "export_participant");
        }
    });

    // 8. Process Seller Verifications (Marketplace)
    console.log("Fetching Seller Verifications...");
    const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).get();
    sellerSnap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.userId) return;
        const up = getUpdates(data.userId);
        if (!up.serviceRegistrations) up.serviceRegistrations = {};
        if (!up.serviceRegistrations.marketplace) up.serviceRegistrations.marketplace = {};
        
        up.serviceRegistrations.marketplace.status = data.status || "pending";
        up.serviceRegistrations.marketplace.updatedAt = new Date();

        if (data.status === "approved") {
            addRole(data.userId, "seller");
        }
    });

    // 9. Apply Updates
    console.log(`Applying updates for ${updatesMap.size} users...`);
    let updatedCount = 0;
    
    // Convert to batches
    let batch = db.batch();
    let count = 0;

    for (const [userId, updates] of updatesMap.entries()) {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const currentUserData = usersMap.get(userId);
        
        if (!currentUserData) {
            console.log(`Skipping unknown user: ${userId}`);
            continue;
        }

        const finalUpdate: any = {
            "serviceRegistrations": { ...currentUserData.serviceRegistrations }
        };

        // Merge service registrations
        for (const [module, moduleData] of Object.entries(updates.serviceRegistrations || {})) {
            finalUpdate.serviceRegistrations[module] = {
                ...(finalUpdate.serviceRegistrations[module] || {}),
                ...(moduleData as any)
            };
        }

        // Merge roles
        const existingRoles = new Set(currentUserData.roles || []);
        const newRoles = rolesToAddMap.get(userId);
        if (newRoles) {
            newRoles.forEach(r => existingRoles.add(r));
        }
        if (!existingRoles.has("general_user")) existingRoles.add("general_user");
        
        finalUpdate.roles = Array.from(existingRoles);

        // CHECK IF ACTUAL CHANGES EXIST BEFORE QUEUING WRITE
        let hasChanges = false;
        
        // 1. Compare roles
        const currentRolesSorted = Array.from(currentUserData.roles || []).sort();
        const finalRolesSorted = Array.from(finalUpdate.roles).sort();
        if (currentRolesSorted.length !== finalRolesSorted.length || 
            !currentRolesSorted.every((val, index) => val === finalRolesSorted[index])) {
            hasChanges = true;
        }

        // 2. Compare service registrations (status, paymentStatus, plan)
        if (!hasChanges) {
            for (const [module, moduleData] of Object.entries(updates.serviceRegistrations || {})) {
                const currentModule = (currentUserData.serviceRegistrations || {})[module] || {};
                const newModule = (finalUpdate.serviceRegistrations || {})[module] || {};
                
                if (currentModule.status !== newModule.status ||
                    currentModule.paymentStatus !== newModule.paymentStatus ||
                    currentModule.plan !== newModule.plan) {
                    hasChanges = true;
                    break;
                }
            }
        }

        if (!hasChanges) {
            // Already synced, skip updating this document to save API calls and avoid network timeouts
            continue;
        }

        batch.update(userRef, finalUpdate);
        count++;
        updatedCount++;

        if (count >= 450) {
            await batch.commit();
            batch = db.batch();
            count = 0;
            console.log(`Committed batch... (${updatedCount} so far)`);
        }
    }

    if (count > 0) {
        await batch.commit();
        console.log(`Committed final batch... (${updatedCount} total)`);
    }

    console.log("Global State Sync Complete! All dashboards and modules should now accurately reflect exact payment and approval states.");
}

globalStateSync().catch(console.error);
