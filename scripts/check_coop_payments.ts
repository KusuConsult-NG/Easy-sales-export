import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing Cooperative Payments and Member Links...");

    // 1. Fetch all completed cooperative payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    console.log(`Total completed processedPayments in DB: ${paymentsSnap.size}`);

    // Map of userId -> payment doc
    const coopPaymentsByUserId = new Map<string, any[]>();
    const coopPaymentsByEmail = new Map<string, any[]>();
    const coopPaymentRefs = new Set<string>();

    let coopPaymentCount = 0;

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        
        // Let's check if it looks like a cooperative payment
        const isCoop = type === "cooperative_membership_registration" || 
                       type === "cooperative" || 
                       String(data.purpose).includes("cooperative") ||
                       String(data.metadata?.purpose).includes("cooperative");
        
        if (isCoop || type === "unknown") {
            coopPaymentCount++;
            const userId = data.userId || data.metadata?.userId || data.paystackMetadata?.userId;
            const email = data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email;
            const ref = data.reference || doc.id;

            coopPaymentRefs.add(ref);

            if (userId) {
                if (!coopPaymentsByUserId.has(userId)) coopPaymentsByUserId.set(userId, []);
                coopPaymentsByUserId.get(userId)!.push(data);
            }
            if (email) {
                const lowerEmail = email.toLowerCase().trim();
                if (!coopPaymentsByEmail.has(lowerEmail)) coopPaymentsByEmail.set(lowerEmail, []);
                coopPaymentsByEmail.get(lowerEmail)!.push(data);
            }
        }
    });

    console.log(`Total completed cooperative-like payments: ${coopPaymentCount}`);
    console.log(`Unique userIds with cooperative payments: ${coopPaymentsByUserId.size}`);
    console.log(`Unique emails with cooperative payments: ${coopPaymentsByEmail.size}`);

    // 2. Load all cooperative members
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Total cooperative members in DB (current status): ${coopSnap.size}`);

    let activeCount = 0;
    let pendingCount = 0;
    let otherCount = 0;

    let matchedByRef = 0;
    let matchedByUserId = 0;
    let matchedByEmail = 0;
    let unpaidButApproved = 0;

    const noRefButHasUserIdPayment: any[] = [];
    const noRefButHasEmailPayment: any[] = [];

    coopSnap.docs.forEach(doc => {
        const member = doc.data();
        const userId = member.userId || doc.id;
        const email = (member.email || "").toLowerCase().trim();
        const ref = member.paymentReference;
        const status = member.status || member.membershipStatus || "pending";

        if (status === "active" || status === "approved") {
            activeCount++;
        } else if (status === "pending") {
            pendingCount++;
        } else {
            otherCount++;
        }

        const hasRefMatch = ref && coopPaymentRefs.has(ref);
        const hasUserIdMatch = userId && coopPaymentsByUserId.has(userId);
        const hasEmailMatch = email && coopPaymentsByEmail.has(email);

        if (hasRefMatch) {
            matchedByRef++;
        } else {
            if (hasUserIdMatch) {
                matchedByUserId++;
                noRefButHasUserIdPayment.push({ userId, email, ref, status, paymentRef: coopPaymentsByUserId.get(userId)![0].reference });
            } else if (hasEmailMatch) {
                matchedByEmail++;
                noRefButHasEmailPayment.push({ userId, email, ref, status, paymentRef: coopPaymentsByEmail.get(email)![0].reference });
            } else {
                unpaidButApproved++;
            }
        }
    });

    console.log(`\nCooperative Members Stats:`);
    console.log(`- Active/Approved members: ${activeCount}`);
    console.log(`- Pending members: ${pendingCount}`);
    console.log(`- Other status members: ${otherCount}`);
    console.log(`\nReconciliation check against completed payments:`);
    console.log(`- Matched by paymentReference: ${matchedByRef}`);
    console.log(`- Not matched by reference, but HAS completed payment for their userId: ${matchedByUserId}`);
    console.log(`- Not matched by reference/userId, but HAS completed payment for their email: ${matchedByEmail}`);

    console.log(`\nSamples of members with no ref but paid by userId (first 5):`);
    console.log(JSON.stringify(noRefButHasUserIdPayment.slice(0, 5), null, 2));

    console.log(`\nSamples of members with no ref but paid by email (first 5):`);
    console.log(JSON.stringify(noRefButHasEmailPayment.slice(0, 5), null, 2));
}

main();
