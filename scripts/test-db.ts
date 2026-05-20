import { config } from "dotenv";
import * as path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function test() {
    console.log("Testing db counts...");
    try {
        const usersCount = await db.collection(COLLECTIONS.USERS).count().get();
        console.log("Total Users in DB:", usersCount.data().count);

        const coopCount = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).count().get();
        console.log("Total Cooperative Members in DB:", coopCount.data().count);

        const sellerCount = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).count().get();
        console.log("Total Seller Verifications in DB:", sellerCount.data().count);
    } catch (err) {
        console.error("Error fetching counts:", err);
    }
}

test().catch(console.error);
