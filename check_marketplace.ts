import { config } from "dotenv";
config({ path: ".env.local" });
import { getAdminDb } from "./src/lib/firebase-admin";

async function run() {
    const db = getAdminDb();
    const usersSnap = await db.collection("users").get();
    let count = 0;
    const statuses = new Map();
    let noReg = 0;
    
    usersSnap.forEach(doc => {
        const data = doc.data();
        const mkt = data.serviceRegistrations?.marketplace;
        if (mkt) {
            count++;
            const s = mkt.status || "NO_STATUS";
            statuses.set(s, (statuses.get(s) || 0) + 1);
        } else if (data.marketplaceAccountType || data.accountType) {
            // legacy marketplace user?
            const s = "LEGACY_NO_REG";
            statuses.set(s, (statuses.get(s) || 0) + 1);
            count++;
        } else {
            noReg++;
        }
    });

    console.log("Total Marketplace Users (either in serviceRegistrations or legacy):", count);
    console.log("Statuses:", Object.fromEntries(statuses));
    console.log("No marketplace info:", noReg);
}

run().catch(console.error);
