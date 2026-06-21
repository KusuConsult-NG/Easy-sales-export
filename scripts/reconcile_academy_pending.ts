import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Reconciling Pending Academy Applications vs Completed Payments...");

    // 1. Fetch completed academy_registration payments
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
                       type === "academy" || 
                       String(data.purpose).includes("academy") ||
                       String(data.metadata?.purpose).includes("academy") ||
                       String(data.paystackMetadata?.purpose).includes("academy");

        if (isAcad) {
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

    // 2. Fetch all academy applications
    const appsSnap = await db.collection("academy_applications").get();
    console.log(`Total academy applications: ${appsSnap.size}`);

    let activePaid = 0;
    let activeUnpaid = 0;
    let pendingPaid = 0;
    let pendingUnpaid = 0;

    const pendingPaidApps: any[] = [];

    appsSnap.docs.forEach(doc => {
        const app = doc.data();
        const userId = app.userId;
        const email = (app.personalInfo?.email || app.email || "").toLowerCase().trim();
        const ref = app.paymentReference;
        const status = app.status || "pending";
        const isActive = status === "approved" || status === "active";

        const hasPayment = 
            (ref && paymentRefs.has(ref)) ||
            (userId && paymentsByUserId.has(userId)) ||
            (email && paymentsByEmail.has(email));

        if (isActive) {
            if (hasPayment) activePaid++;
            else activeUnpaid++;
        } else {
            if (hasPayment) {
                pendingPaid++;
                const matchingPayment = (userId && paymentsByUserId.get(userId)) ? paymentsByUserId.get(userId)![0] : (email ? paymentsByEmail.get(email)![0] : null);
                pendingPaidApps.push({
                    docId: doc.id,
                    userId,
                    email,
                    name: app.personalInfo?.fullName || "Unknown",
                    status,
                    paymentStatus: app.paymentStatus,
                    paymentRef: matchingPayment ? matchingPayment.reference : ref,
                    paymentAmount: matchingPayment ? matchingPayment.amount : 0
                });
            } else {
                pendingUnpaid++;
            }
        }
    });

    console.log(`\nAcademy Applications breakdown:`);
    console.log(`- Approved & Paid: ${activePaid}`);
    console.log(`- Approved but Unpaid: ${activeUnpaid}`);
    console.log(`- Pending & Paid: ${pendingPaid}`);
    console.log(`- Pending & Unpaid: ${pendingUnpaid}`);

    if (pendingPaidApps.length > 0) {
        console.log(`\nSamples of Pending & Paid academy applications:`);
        console.log(JSON.stringify(pendingPaidApps, null, 2));
    }
}

main();
