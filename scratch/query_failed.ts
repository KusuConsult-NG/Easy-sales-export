import { config } from "dotenv";
config({ path: ".env.local" });
import { getAdminDb } from "../src/lib/firebase-admin";

async function query() {
    const db = getAdminDb();
    
    const snap = await db.collection("failed_payments").limit(5).get();
    console.log("FAILED_PAYMENTS collection count:", snap.size);
    if (snap.size > 0) {
        console.log("Sample:", snap.docs[0].data());
    }

    const usersSnap = await db.collection("users").limit(10).get();
    console.log("Sample users regs:", usersSnap.docs.map(d => d.data().serviceRegistrations));
}

query().then(() => process.exit(0)).catch(console.error);
