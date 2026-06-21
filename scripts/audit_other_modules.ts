import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("=========================================");
    console.log("AUDITING ACADEMY, EXPORT, AND FARM NATION");
    console.log("=========================================");

    // 1. Fetch completed payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    console.log(`Total completed processedPayments: ${paymentsSnap.size}`);

    // Group completed payments by type
    const paymentsByType = new Map<string, any[]>();
    const paymentRefs = new Set<string>();
    const paymentsByUserId = new Map<string, any[]>();
    const paymentsByEmail = new Map<string, any[]>();

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        const ref = data.reference || doc.id;
        const userId = data.userId || data.metadata?.userId || data.paystackMetadata?.userId;
        const email = data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email;

        const paymentInfo = {
            reference: ref,
            userId,
            email,
            amount: data.amount,
            type,
            docId: doc.id
        };

        if (!paymentsByType.has(type)) {
            paymentsByType.set(type, []);
        }
        paymentsByType.get(type)!.push(paymentInfo);
        paymentRefs.add(ref);

        if (userId) {
            if (!paymentsByUserId.has(userId)) paymentsByUserId.set(userId, []);
            paymentsByUserId.get(userId)!.push(paymentInfo);
        }
        if (email) {
            const lower = email.toLowerCase().trim();
            if (!paymentsByEmail.has(lower)) paymentsByEmail.set(lower, []);
            paymentsByEmail.get(lower)!.push(paymentInfo);
        }
    });

    console.log("\nCompleted Payment Types Distribution:");
    for (const [type, list] of paymentsByType.entries()) {
        console.log(`- ${type}: ${list.length} payments`);
    }

    // 2. AUDIT ACADEMY APPLICATIONS & ENROLLMENTS
    console.log("\n--- Academy Applications Audit ---");
    const acadAppsSnap = await db.collection("academy_applications").get();
    console.log(`Total academy_applications: ${acadAppsSnap.size}`);

    const acadAppStatus: Record<string, number> = {};
    const acadAppPaymentStatus: Record<string, number> = {};
    let approvedApps = 0;
    let approvedAppsPaid = 0;
    let approvedAppsUnpaid = 0;

    acadAppsSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "pending";
        const paymentStatus = data.paymentStatus || "pending";

        acadAppStatus[status] = (acadAppStatus[status] || 0) + 1;
        acadAppPaymentStatus[paymentStatus] = (acadAppPaymentStatus[paymentStatus] || 0) + 1;

        if (status === "approved" || status === "active") {
            approvedApps++;
            const userId = data.userId;
            const email = (data.personalInfo?.email || "").toLowerCase().trim();
            const ref = data.paymentReference;

            const hasPayment = 
                (ref && paymentRefs.has(ref)) ||
                (userId && paymentsByUserId.has(userId)) ||
                (email && paymentsByEmail.has(email));

            if (hasPayment) {
                approvedAppsPaid++;
            } else {
                approvedAppsUnpaid++;
            }
        }
    });

    console.log("Status distribution:", acadAppStatus);
    console.log("Payment status distribution:", acadAppPaymentStatus);
    console.log(`Approved/Active Applications: ${approvedApps}`);
    console.log(`- Paid: ${approvedAppsPaid}`);
    console.log(`- Unpaid: ${approvedAppsUnpaid}`);

    console.log("\n--- Academy Enrollments Audit ---");
    const acadEnrsSnap = await db.collection("academy_enrollments").get();
    console.log(`Total academy_enrollments: ${acadEnrsSnap.size}`);

    const acadEnrStatus: Record<string, number> = {};
    const acadEnrPaymentStatus: Record<string, number> = {};
    let activeEnrollments = 0;
    let activeEnrollmentsPaid = 0;
    let activeEnrollmentsLegacy = 0;
    let activeEnrollmentsUnpaid = 0;

    acadEnrsSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "pending";
        const paymentStatus = data.paymentStatus || "pending";

        acadEnrStatus[status] = (acadEnrStatus[status] || 0) + 1;
        acadEnrPaymentStatus[paymentStatus] = (acadEnrPaymentStatus[paymentStatus] || 0) + 1;

        const isActive = status === "active" || status === "approved";
        if (isActive) {
            activeEnrollments++;
            const isLegacy = data._isLegacy === true || data._legacyOnboardedBy || data.isLegacy === true;
            const userId = data.userId;
            const email = (data.studentEmail || "").toLowerCase().trim();
            const ref = data.paymentReference;

            const hasPayment = 
                (ref && paymentRefs.has(ref)) ||
                (userId && paymentsByUserId.has(userId)) ||
                (email && paymentsByEmail.has(email));

            if (hasPayment) {
                activeEnrollmentsPaid++;
            } else if (isLegacy) {
                activeEnrollmentsLegacy++;
            } else {
                activeEnrollmentsUnpaid++;
            }
        }
    });

    console.log("Status distribution:", acadEnrStatus);
    console.log("Payment status distribution:", acadEnrPaymentStatus);
    console.log(`Active/Approved Enrollments: ${activeEnrollments}`);
    console.log(`- Paid: ${activeEnrollmentsPaid}`);
    console.log(`- Legacy: ${activeEnrollmentsLegacy}`);
    console.log(`- Unpaid (No payment record): ${activeEnrollmentsUnpaid}`);

    // 3. AUDIT EXPORT APPLICATIONS
    console.log("\n--- Export Onboarding Applications Audit ---");
    const exportAppsSnap = await db.collection("export_onboarding_applications").get();
    console.log(`Total export_onboarding_applications: ${exportAppsSnap.size}`);

    const exportAppStatus: Record<string, number> = {};
    const exportAppPaymentStatus: Record<string, number> = {};
    let activeExport = 0;
    let activeExportPaid = 0;
    let activeExportLegacy = 0;
    let activeExportUnpaid = 0;

    exportAppsSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "pending";
        const paymentStatus = data.paymentStatus || "pending";

        exportAppStatus[status] = (exportAppStatus[status] || 0) + 1;
        exportAppPaymentStatus[paymentStatus] = (exportAppPaymentStatus[paymentStatus] || 0) + 1;

        const isActive = status === "active" || status === "approved";
        if (isActive) {
            activeExport++;
            const isLegacy = data.isLegacy === true || data._isLegacy === true;
            const userId = data.userId;
            const email = (data.email || data.personalInfo?.email || "").toLowerCase().trim();
            const ref = data.paymentReference;

            const hasPayment = 
                (ref && paymentRefs.has(ref)) ||
                (userId && paymentsByUserId.has(userId)) ||
                (email && paymentsByEmail.has(email));

            if (hasPayment) {
                activeExportPaid++;
            } else if (isLegacy) {
                activeExportLegacy++;
            } else {
                activeExportUnpaid++;
            }
        }
    });

    console.log("Status distribution:", exportAppStatus);
    console.log("Payment status distribution:", exportAppPaymentStatus);
    console.log(`Active/Approved Export Applications: ${activeExport}`);
    console.log(`- Paid: ${activeExportPaid}`);
    console.log(`- Legacy: ${activeExportLegacy}`);
    console.log(`- Unpaid: ${activeExportUnpaid}`);

    // 4. AUDIT FARM NATION APPLICATIONS
    console.log("\n--- Farm Nation Applications Audit ---");
    const farmAppsSnap = await db.collection("farm_nation_applications").get();
    console.log(`Total farm_nation_applications: ${farmAppsSnap.size}`);

    const farmAppStatus: Record<string, number> = {};
    const farmAppPaymentStatus: Record<string, number> = {};
    let activeFarm = 0;
    let activeFarmPaid = 0;
    let activeFarmLegacy = 0;
    let activeFarmUnpaid = 0;

    farmAppsSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "pending";
        const paymentStatus = data.paymentStatus || "pending";

        farmAppStatus[status] = (farmAppStatus[status] || 0) + 1;
        farmAppPaymentStatus[paymentStatus] = (farmAppPaymentStatus[paymentStatus] || 0) + 1;

        const isActive = status === "active" || status === "approved";
        if (isActive) {
            activeFarm++;
            const isLegacy = data.isLegacy === true || data._isLegacy === true;
            const userId = data.userId;
            const email = (data.email || data.personalInfo?.email || "").toLowerCase().trim();
            const ref = data.paymentReference;

            const hasPayment = 
                (ref && paymentRefs.has(ref)) ||
                (userId && paymentsByUserId.has(userId)) ||
                (email && paymentsByEmail.has(email));

            if (hasPayment) {
                activeFarmPaid++;
            } else if (isLegacy) {
                activeFarmLegacy++;
            } else {
                activeFarmUnpaid++;
            }
        }
    });

    console.log("Status distribution:", farmAppStatus);
    console.log("Payment status distribution:", farmAppPaymentStatus);
    console.log(`Active/Approved Farm Nation Applications: ${activeFarm}`);
    console.log(`- Paid: ${activeFarmPaid}`);
    console.log(`- Legacy: ${activeFarmLegacy}`);
    console.log(`- Unpaid: ${activeFarmUnpaid}`);
}

main().catch(err => {
    console.error(err);
});
