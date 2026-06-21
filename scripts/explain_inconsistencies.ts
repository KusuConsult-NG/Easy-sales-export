import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing Inconsistency Details in Academy, Export, and Farm Nation...");

    // 1. Academy Approved Unpaid
    const acadAppsSnap = await db.collection("academy_applications")
        .where("status", "==", "approved")
        .get();

    // Fetch payments to filter
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

    const unpaidAcad: any[] = [];
    acadAppsSnap.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId;
        const email = (data.personalInfo?.email || data.email || "").toLowerCase().trim();
        const ref = data.paymentReference;

        const hasPayment = 
            (ref && paymentRefs.has(ref)) ||
            (userId && paymentsByUserId.has(userId)) ||
            (email && paymentsByEmail.add(email));

        if (!hasPayment) {
            unpaidAcad.push({
                docId: doc.id,
                userId,
                email,
                name: data.personalInfo?.fullName || "Unknown",
                paymentStatus: data.paymentStatus,
                reviewedBy: data.reviewedBy || null,
                _system_healed_recovery: data._system_healed_recovery || null,
                isLegacy: data.isLegacy || data._isLegacy || null,
                _importSource: data._importSource || null
            });
        }
    });

    console.log(`\nUnpaid Approved Academy Applications count: ${unpaidAcad.length}`);
    console.log("Sample of unpaid approved Academy applications:");
    console.log(JSON.stringify(unpaidAcad.slice(0, 10), null, 2));

    // 2. Export Onboarding Applications
    const expAppsSnap = await db.collection("export_onboarding_applications")
        .where("status", "==", "approved")
        .get();

    const unpaidExp: any[] = [];
    expAppsSnap.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId;
        const email = (data.email || data.personalInfo?.email || "").toLowerCase().trim();
        const ref = data.paymentReference;

        const hasPayment = 
            (ref && paymentRefs.has(ref)) ||
            (userId && paymentsByUserId.has(userId)) ||
            (email && paymentsByEmail.has(email));

        if (!hasPayment) {
            unpaidExp.push({
                docId: doc.id,
                userId,
                email,
                name: data.personalInfo?.fullName || "Unknown",
                paymentStatus: data.paymentStatus,
                reviewedBy: data.reviewedBy || null,
                isLegacy: data.isLegacy || data._isLegacy || null
            });
        }
    });

    console.log(`\nUnpaid Approved Export Applications count: ${unpaidExp.length}`);
    console.log("Details of unpaid approved Export applications:");
    console.log(JSON.stringify(unpaidExp, null, 2));

    // 3. Farm Nation Applications
    const farmAppsSnap = await db.collection("farm_nation_applications")
        .where("status", "==", "approved")
        .get();

    const unpaidFarm: any[] = [];
    farmAppsSnap.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId;
        const email = (data.email || data.personalInfo?.email || "").toLowerCase().trim();
        const ref = data.paymentReference;

        const hasPayment = 
            (ref && paymentRefs.has(ref)) ||
            (userId && paymentsByUserId.has(userId)) ||
            (email && paymentsByEmail.has(email));

        if (!hasPayment) {
            unpaidFarm.push({
                docId: doc.id,
                userId,
                email,
                name: data.personalInfo?.fullName || "Unknown",
                paymentStatus: data.paymentStatus,
                approvedBy: data.approvedBy || null,
                isLegacy: data.isLegacy || data._isLegacy || null
            });
        }
    });

    console.log(`\nUnpaid Approved Farm Nation Applications count: ${unpaidFarm.length}`);
    console.log("Sample of unpaid approved Farm Nation applications:");
    console.log(JSON.stringify(unpaidFarm.slice(0, 10), null, 2));
}

main();
