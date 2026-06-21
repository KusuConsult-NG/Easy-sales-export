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
    const paymentsByUserId = new Map<string, any[]>();
    const paymentsByEmail = new Map<string, any[]>();

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        
        const isAcad = type === "academy_registration" || 
                       String(data.purpose).includes("academy") ||
                       String(data.metadata?.purpose).includes("academy");

        if (isAcad || type === "unknown") {
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
        }
    });

    // 2. Fetch approved applications
    const appsSnap = await db.collection("academy_applications")
        .where("status", "==", "approved")
        .get();

    console.log(`Total approved academy applications: ${appsSnap.size}`);

    const unpaidApps: any[] = [];

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
            unpaidApps.push({
                docId: doc.id,
                userId,
                email,
                name: app.personalInfo?.fullName || app.personalInfo?.firstName || "Unknown",
                paymentReference: ref,
                paymentStatus: app.paymentStatus,
                reviewedBy: app.reviewedBy,
                reviewedAt: app.reviewedAt,
                _system_healed_recovery: app._system_healed_recovery
            });
        }
    });

    console.log(`Found ${unpaidApps.length} unpaid approved applications.`);
    console.log("\nSamples of unpaid approved applications (first 10):");
    console.log(JSON.stringify(unpaidApps.slice(0, 10), null, 2));
}

main();
