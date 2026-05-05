
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { redis, CacheKeys } from "../src/lib/redis";

async function bypassOnboarding(email: string) {
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

    const currentRoles = userData.roles || [];
    if (!currentRoles.includes("cooperative_member")) {
        currentRoles.push("cooperative_member");
    }

    const updateData = {
        roles: currentRoles,
        "serviceRegistrations.cooperative": {
            status: "approved",
            tier: "tier1", 
            approvedAt: new Date(),
            onboardingCompleted: true
        }
    };

    await db.collection(COLLECTIONS.USERS).doc(userId).update(updateData);
    
    // Also create a record in COOPERATIVE_MEMBERS collection
    await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).set({
        userId,
        email,
        status: "active",
        membershipStatus: "active",
        paymentStatus: "completed",
        onboardingCompleted: true,
        savingsBalance: 0,
        loanBalance: 0,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
    }, { merge: true });

    // Invalidate Redis Cache
    try {
        const cacheKey = CacheKeys.userProfile(userId);
        await redis.del(cacheKey);
        console.log(`Invalidated cache for user: ${userId}`);
    } catch (err) {
        console.error("Redis invalidation failed:", err);
    }

    console.log(`Successfully bypassed onboarding for ${email}`);
}

bypassOnboarding("cooperativeuser02@gmail.com")
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
