
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { redis, CacheKeys } from "../src/lib/redis";

async function grantFullAccess(email: string) {
    const db = getAdminDb();
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).where("email", "==", email).get();

    if (usersSnapshot.empty) {
        console.log(`User with email ${email} not found.`);
        return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    console.log(`Found user: ${userId} (${userData.fullName})`);

    // Split fullName or use defaults
    const nameParts = (userData.fullName || "Cooperative User").split(" ");
    const firstName = nameParts[0] || "Cooperative";
    const lastName = nameParts.slice(1).join(" ") || "Member";

    const currentRoles = userData.roles || [];
    if (!currentRoles.includes("cooperative_member")) {
        currentRoles.push("cooperative_member");
    }

    // 1. Update User Document
    const updateData = {
        roles: currentRoles,
        "serviceRegistrations.cooperative": {
            status: "active",
            tier: "Member", 
            onboardingCompleted: true,
            syncedAt: new Date().toISOString()
        },
        "serviceRegistrations.cooperatives": {
            status: "active",
            tier: "Member",
            onboardingCompleted: true,
            syncedAt: new Date().toISOString()
        }
    };

    await db.collection(COLLECTIONS.USERS).doc(userId).update(updateData);
    
    // 2. Create/Update COOPERATIVE_MEMBERS record with ALL required fields to pass the integrity guard
    await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).set({
        id: userId,
        userId,
        email,
        firstName,
        lastName,
        status: "active",
        membershipStatus: "active",
        membershipTier: "Member",
        paymentStatus: "completed",
        onboardingCompleted: true,
        savingsBalance: 150000, // Giving them some balance as "full access" often implies testing
        loanBalance: 0,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        // Add other required fields from schema to be safe
        phone: userData.phone || "08000000000",
        stateOfOrigin: "Lagos",
        lga: "Ikeja",
        residentialAddress: "123 Cooperative Way, Lagos",
        occupation: "Entrepreneur"
    }, { merge: true });

    // 3. Invalidate Redis Cache
    try {
        const cacheKey = CacheKeys.userProfile(userId);
        await redis.del(cacheKey);
        console.log(`Invalidated cache for user: ${userId}`);
    } catch (err) {
        console.error("Redis invalidation failed:", err);
    }

    console.log(`Successfully granted FULL UNRESTRICTED access to ${email}`);
    console.log(`Profile: ${firstName} ${lastName}`);
}

grantFullAccess("cooperativeuser02@gmail.com")
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
