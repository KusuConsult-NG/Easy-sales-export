import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing Unpaid Approved Academy Applications...");

    // 1. Fetch completed payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    const paymentRefs = new Set<string>();
    const paymentsByUserId = new Set<string>();
    const paymentsByEmail = new Set<string>();

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const ref = data.reference || doc.id;
        const userId = data.userId || data.metadata?.userId || data.paystackMetadata?.userId;
        const email = data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email;

        paymentRefs.add(ref);
        if (userId) paymentsByUserId.add(userId);
        if (email) paymentsByEmail.add(email.toLowerCase().trim());
    });

    // 2. Fetch approved applications
    const appsSnap = await db.collection("academy_applications")
        .where("status", "==", "approved")
        .get();

    let manualAdminCount = 0;
    let systemHealedCount = 0;
    let testAdminCount = 0;
    let otherCount = 0;

    const manualAdminList: any[] = [];
    const systemHealedList: any[] = [];

    appsSnap.docs.forEach(doc => {
        const app = doc.data();
        const userId = app.userId;
        const email = (app.personalInfo?.email || app.email || "").toLowerCase().trim();
        const ref = app.paymentReference;

        const hasPayment = 
            (ref && paymentRefs.has(ref)) ||
            (userId && paymentsByUserId.has(userId)) ||
            (email && paymentsByEmail.has(email));

        if (!hasPayment) {
            const reviewedBy = app.reviewedBy || "";
            const isHealed = app._system_healed_recovery || app.source === "backfill_script_v2";

            const info = {
                docId: doc.id,
                userId,
                email,
                name: app.personalInfo?.fullName || "Unknown",
                reviewedBy,
                source: app.source || null,
                _system_healed_recovery: app._system_healed_recovery || null
            };

            if (reviewedBy === "admin-test-id") {
                testAdminCount++;
                systemHealedList.push(info);
            } else if (isHealed || !reviewedBy) {
                systemHealedCount++;
                systemHealedList.push(info);
            } else {
                manualAdminCount++;
                manualAdminList.push(info);
            }
        }
    });

    console.log(`\nUnpaid Approved Academy Applications:`);
    console.log(`- Manually Approved by Admin: ${manualAdminCount}`);
    console.log(`- System Healed / Backfilled: ${systemHealedCount}`);
    console.log(`- Test Admin Approved: ${testAdminCount}`);

    console.log("\n--- Manually Approved by Admin (Sample/List) ---");
    console.log(JSON.stringify(manualAdminList, null, 2));

    console.log("\n--- System Healed / Backfilled (Sample/List) ---");
    console.log(JSON.stringify(systemHealedList, null, 2));
}

main();
