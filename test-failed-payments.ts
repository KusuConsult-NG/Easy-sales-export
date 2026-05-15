import { getAdminDb } from "./src/lib/firebase-admin";
import { COLLECTIONS } from "./src/lib/types/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function run() {
    const db = getAdminDb();
    const snap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).get();
    console.log("Total failed payments:", snap.size);
    if (snap.size > 0) {
        console.log("Sample failed payment:", snap.docs[0].data());
    }
    process.exit(0);
}
run();
