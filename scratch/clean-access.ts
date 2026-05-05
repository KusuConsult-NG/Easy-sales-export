
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { redis, CacheKeys } from "../src/lib/redis";

async function resetAndCleanAccess(email: string) {
    const db = getAdminDb();
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).where("email", "==", email).get();

    if (usersSnapshot.empty) {
        console.log(`User with email ${email} not found.`);
        return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    console.log(`Cleaning data for user: ${userId} (${userData.fullName}) in Firestore...`);

    const nameParts = (userData.fullName || "Cooperative User").split(" ");
    const firstName = nameParts[0] || "Cooperative";
    const lastName = nameParts.slice(1).join(" ") || "Member";

    // 1. Update User Document in Firestore
    const updateData = {
        roles: userData.roles || ["cooperative_member"],
        "serviceRegistrations.cooperative": {
            status: "active",
            tier: "Member", 
            onboardingCompleted: true,
            syncedAt: new Date().toISOString()
        }
    };

    await db.collection(COLLECTIONS.USERS).doc(userId).update(updateData);
    
    // 2. Reset COOPERATIVE_MEMBERS record in Firestore (Strict Real Data)
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
        savingsBalance: 0, // Reset to 0 as requested
        loanBalance: 0,
        joinedAt: new Date(),
        updatedAt: new Date(),
        // Real user data from the profile where possible
        phone: userData.phone || "08000000000",
        stateOfOrigin: userData.state || "Lagos",
        lga: userData.lga || "Ikeja",
        residentialAddress: userData.address || "123 Cooperative Way, Lagos",
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

    console.log(`Successfully cleaned and granted access to ${email} in Firebase.`);
}

resetAndCleanAccess("cooperativeuser02@gmail.com")
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
