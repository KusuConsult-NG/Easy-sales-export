
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { redis, CacheKeys } from "../src/lib/redis";

async function purgeMockData(email: string) {
    const db = getAdminDb();
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).where("email", "==", email).get();

    if (usersSnapshot.empty) {
        console.log(`User with email ${email} not found.`);
        return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;

    console.log(`Purging mock data for user: ${userId} (${email})...`);

    // 1. Reset Member Balances
    await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).update({
        savingsBalance: 0,
        loanBalance: 0,
        updatedAt: new Date()
    });

    // 2. Delete All Cooperative Transactions for this user
    const txSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
        .where("userId", "==", userId)
        .get();

    if (!txSnapshot.empty) {
        const batch = db.batch();
        txSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`Deleted ${txSnapshot.size} mock transactions.`);
    }

    // 3. Clear Cache
    await redis.del(CacheKeys.userProfile(userId));

    console.log(`Successfully purged all mock data for ${email}. Account is now clean.`);
}

purgeMockData("cooperativeuser02@gmail.com")
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
