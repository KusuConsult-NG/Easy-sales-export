import { getAdminAuth, getAdminDb } from "../src/lib/firebase-admin";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

async function main() {
    const db = getAdminDb();
    const auth = getAdminAuth();

    console.log("Analyzing Firestore database status...");

    const collections = [
        "users",
        "products",
        "land_listings",
        "land_verifications",
        "marketplaceOrders",
        "escrow_transactions",
        "disputes",
        "processedPayments",
        "failedPayments",
        "cooperative_members",
        "wave_applications",
        "academy_applications",
        "export_applications",
        "seller_verifications"
    ];

    for (const col of collections) {
        const snap = await db.collection(col).get();
        console.log(`Collection: ${col.padEnd(25)} | Count: ${snap.size}`);
    }

    console.log("\n--- Listing Users in Firestore ---");
    const usersSnap = await db.collection("users").get();
    for (const doc of usersSnap.docs) {
        const data = doc.data();
        console.log(`Firestore User: UID=${doc.id.padEnd(30)} | Email=${(data.email || "N/A").padEnd(40)} | Name=${data.fullName || data.name || "N/A"} | Roles=${JSON.stringify(data.roles || [])}`);
    }
}

main().catch(err => {
    console.error("Analysis failed:", err);
});
