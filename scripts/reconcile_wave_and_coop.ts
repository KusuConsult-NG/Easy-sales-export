import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("=========================================");
    console.log("DATABASE AUDIT & RECONCILIATION (OPTIMIZED)");
    console.log("=========================================");

    // 1. WAVE AUDIT
    console.log("\n--- WAVE Program Audit ---");
    const appsSnap = await db.collection("wave_applications").get();
    console.log(`Total documents in 'wave_applications': ${appsSnap.size}`);

    const waveStatusCounts: Record<string, number> = {};
    const approvedWaveUsers: string[] = [];

    for (const doc of appsSnap.docs) {
        const app = doc.data();
        const status = app.status || "pending";
        waveStatusCounts[status] = (waveStatusCounts[status] || 0) + 1;

        if (status === "approved" || status === "active") {
            if (app.userId) {
                approvedWaveUsers.push(app.userId);
            }
        }
    }
    console.log("WAVE Applications status distribution:", waveStatusCounts);
    console.log(`WAVE Applications with 'approved'/'active' status: ${approvedWaveUsers.length}`);

    const waveMembersSnap = await db.collection("wave_members").count().get();
    console.log(`Total documents in 'wave_members' collection: ${waveMembersSnap.data().count}`);

    // Check users collection for WAVE roles using array-contains
    const waveParticipantSnap = await db.collection("users").where("roles", "array-contains", "wave_participant").count().get();
    const waveAdminSnap = await db.collection("users").where("roles", "array-contains", "wave_admin").count().get();
    console.log(`Users with 'wave_participant' role in users: ${waveParticipantSnap.data().count}`);
    console.log(`Users with 'wave_admin' role in users: ${waveAdminSnap.data().count}`);

    // 2. COOPERATIVE AUDIT
    console.log("\n--- Cooperative Members Audit ---");
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Total documents in 'cooperative_members': ${coopSnap.size}`);

    const coopStatusCounts: Record<string, number> = {};
    const coopPaymentStatusCounts: Record<string, number> = {};
    let activeOrApprovedCount = 0;
    let legacyMembersCount = 0;
    let manualOrHealedCount = 0;
    let regularPaidCount = 0;
    let regularUnpaidCount = 0;

    const completedRefs = new Set<string>();
    
    // Load processedPayments using select('reference') to minimize memory and payload
    console.log("Fetching completed processedPayments references...");
    const processedPaymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .select("reference")
        .get();
    processedPaymentsSnap.docs.forEach(doc => {
        const ref = doc.data().reference;
        if (ref) completedRefs.add(ref);
    });
    console.log(`Loaded ${completedRefs.size} completed payment references from Firestore.`);

    const unpaidSample: any[] = [];

    for (const doc of coopSnap.docs) {
        const member = doc.data();
        const status = member.status || member.membershipStatus || "pending";
        const paymentStatus = member.paymentStatus || "pending";

        coopStatusCounts[status] = (coopStatusCounts[status] || 0) + 1;
        coopPaymentStatusCounts[paymentStatus] = (coopPaymentStatusCounts[paymentStatus] || 0) + 1;

        const isActiveOrApproved = status === "active" || status === "approved";
        if (isActiveOrApproved) {
            activeOrApprovedCount++;
        }

        const isLegacy = 
            member._importSource === "legacy_csv_import" || 
            member.isLegacy === true || 
            member.legacyOnboardedBy || 
            member.paymentReference === "LEGACY_IMPORT_RECEIPT";

        const isManual = 
            member.approvedBy || 
            member.approvedAt || 
            member._system_healed || 
            member.healedByScript;

        if (isLegacy) {
            legacyMembersCount++;
        } else if (isManual) {
            manualOrHealedCount++;
        } else if (isActiveOrApproved) {
            // Check if payment reference is valid and exists in completed processedPayments
            const ref = member.paymentReference;
            if (ref && completedRefs.has(ref)) {
                regularPaidCount++;
            } else {
                regularUnpaidCount++;
                if (unpaidSample.length < 5) {
                    unpaidSample.push({
                        userId: member.userId || doc.id,
                        email: member.email,
                        status,
                        paymentStatus,
                        paymentReference: ref || "(none)"
                    });
                }
            }
        }
    }

    console.log("Cooperative Members status distribution:", coopStatusCounts);
    console.log("Cooperative Members payment status distribution:", coopPaymentStatusCounts);
    console.log(`Active or Approved members: ${activeOrApprovedCount}`);
    console.log(`- Legacy members: ${legacyMembersCount}`);
    console.log(`- Manually approved/healed members: ${manualOrHealedCount}`);
    console.log(`- Regular active/approved paid members (with completed reference): ${regularPaidCount}`);
    console.log(`- Regular active/approved unpaid members (no matching completed reference): ${regularUnpaidCount}`);
    
    if (unpaidSample.length > 0) {
        console.log("\nSample regular active/approved members without completed payment references:");
        console.log(unpaidSample);
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
