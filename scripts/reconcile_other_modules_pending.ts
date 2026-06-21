import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing Export & Farm Nation Applications vs Completed Payments...");

    // 1. Fetch completed payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    const paymentRefs = new Set<string>();
    const paymentsByUserId = new Map<string, any[]>();
    const paymentsByEmail = new Map<string, any[]>();

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const ref = data.reference || doc.id;
        const userId = data.userId || data.metadata?.userId || data.paystackMetadata?.userId;
        const email = data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email;

        paymentRefs.add(ref);
        if (userId) {
            if (!paymentsByUserId.has(userId)) paymentsByUserId.set(userId, []);
            paymentsByUserId.get(userId)!.push(data);
        }
        if (email) {
            const lower = email.toLowerCase().trim();
            if (!paymentsByEmail.has(lower)) paymentsByEmail.set(lower, []);
            paymentsByEmail.get(lower)!.push(data);
        }
    });

    console.log(`Loaded ${paymentRefs.size} completed payments.`);

    // 2. Export Onboarding Applications
    console.log("\n--- Export Onboarding Applications Reconcile ---");
    const exportAppsSnap = await db.collection("export_onboarding_applications").get();
    
    let expApprovedPaid = 0;
    let expApprovedUnpaid = 0;
    let expPendingPaid = 0;
    let expPendingUnpaid = 0;

    const expPendingPaidList: any[] = [];

    exportAppsSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "pending";
        const isActive = status === "approved" || status === "active";
        const userId = data.userId;
        const email = (data.email || data.personalInfo?.email || "").toLowerCase().trim();
        const ref = data.paymentReference;

        const hasPayment = 
            (ref && paymentRefs.has(ref)) ||
            (userId && paymentsByUserId.has(userId)) ||
            (email && paymentsByEmail.has(email));

        if (isActive) {
            if (hasPayment) expApprovedPaid++;
            else expApprovedUnpaid++;
        } else {
            if (hasPayment) {
                expPendingPaid++;
                const matchingPayment = (userId && paymentsByUserId.get(userId)) ? paymentsByUserId.get(userId)![0] : (email ? paymentsByEmail.get(email)![0] : null);
                expPendingPaidList.push({
                    docId: doc.id,
                    userId,
                    email,
                    name: data.personalInfo?.fullName || "Unknown",
                    status,
                    paymentRef: matchingPayment ? matchingPayment.reference : ref,
                    paymentType: matchingPayment ? (matchingPayment.type || matchingPayment.purpose || "unknown") : "unknown",
                    paymentAmount: matchingPayment ? matchingPayment.amount : 0
                });
            } else {
                expPendingUnpaid++;
            }
        }
    });

    console.log(`Export Applications breakdown:`);
    console.log(`- Approved & Paid: ${expApprovedPaid}`);
    console.log(`- Approved but Unpaid: ${expApprovedUnpaid}`);
    console.log(`- Pending & Paid: ${expPendingPaid}`);
    console.log(`- Pending & Unpaid: ${expPendingUnpaid}`);

    if (expPendingPaidList.length > 0) {
        console.log(`\nSamples of Pending & Paid Export applications:`);
        console.log(JSON.stringify(expPendingPaidList.slice(0, 10), null, 2));
    }

    // 3. Farm Nation Applications
    console.log("\n--- Farm Nation Applications Reconcile ---");
    const farmAppsSnap = await db.collection("farm_nation_applications").get();
    
    let farmApprovedPaid = 0;
    let farmApprovedUnpaid = 0;
    let farmPendingPaid = 0;
    let farmPendingUnpaid = 0;

    const farmPendingPaidList: any[] = [];

    farmAppsSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "pending";
        const isActive = status === "approved" || status === "active";
        const userId = data.userId;
        const email = (data.email || data.personalInfo?.email || "").toLowerCase().trim();
        const ref = data.paymentReference;

        const hasPayment = 
            (ref && paymentRefs.has(ref)) ||
            (userId && paymentsByUserId.has(userId)) ||
            (email && paymentsByEmail.has(email));

        if (isActive) {
            if (hasPayment) farmApprovedPaid++;
            else farmApprovedUnpaid++;
        } else {
            if (hasPayment) {
                farmPendingPaid++;
                const matchingPayment = (userId && paymentsByUserId.get(userId)) ? paymentsByUserId.get(userId)![0] : (email ? paymentsByEmail.get(email)![0] : null);
                farmPendingPaidList.push({
                    docId: doc.id,
                    userId,
                    email,
                    name: data.personalInfo?.fullName || "Unknown",
                    status,
                    paymentRef: matchingPayment ? matchingPayment.reference : ref,
                    paymentType: matchingPayment ? (matchingPayment.type || matchingPayment.purpose || "unknown") : "unknown",
                    paymentAmount: matchingPayment ? matchingPayment.amount : 0
                });
            } else {
                farmPendingUnpaid++;
            }
        }
    });

    console.log(`Farm Nation Applications breakdown:`);
    console.log(`- Approved & Paid: ${farmApprovedPaid}`);
    console.log(`- Approved but Unpaid: ${farmApprovedUnpaid}`);
    console.log(`- Pending & Paid: ${farmPendingPaid}`);
    console.log(`- Pending & Unpaid: ${farmPendingUnpaid}`);

    if (farmPendingPaidList.length > 0) {
        console.log(`\nSamples of Pending & Paid Farm Nation applications:`);
        console.log(JSON.stringify(farmPendingPaidList.slice(0, 10), null, 2));
    }
}

main();
