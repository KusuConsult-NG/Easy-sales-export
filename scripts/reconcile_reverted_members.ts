import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing reverted members vs completed payments...");

    // 1. Fetch completed payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    const coopPaymentUserIds = new Set<string>();
    const coopPaymentEmails = new Set<string>();
    const coopPaymentRefs = new Map<string, string>(); // userId -> reference

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        
        const isCoop = type === "cooperative_membership_registration" || 
                       type === "cooperative" || 
                       String(data.purpose).includes("cooperative") ||
                       String(data.metadata?.purpose).includes("cooperative");
        
        if (isCoop || type === "unknown") {
            const userId = data.userId || data.metadata?.userId || data.paystackMetadata?.userId;
            const email = data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email;
            const ref = data.reference || doc.id;

            if (userId) {
                coopPaymentUserIds.add(userId);
                coopPaymentRefs.set(userId, ref);
            }
            if (email) {
                coopPaymentEmails.add(email.toLowerCase().trim());
            }
        }
    });

    // 2. Fetch all cooperative members
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Total cooperative members: ${coopSnap.size}`);

    let activeCount = 0;
    let pendingCount = 0;
    let revertedWithPayment = 0;
    const toRestore: any[] = [];

    coopSnap.docs.forEach(doc => {
        const member = doc.data();
        const userId = member.userId || doc.id;
        const email = (member.email || "").toLowerCase().trim();
        const status = member.status || member.membershipStatus || "pending";

        if (status === "active" || status === "approved") {
            activeCount++;
        } else if (status === "pending") {
            pendingCount++;
            
            // Check if this pending user has a payment!
            const hasUserIdPayment = userId && coopPaymentUserIds.has(userId);
            const hasEmailPayment = email && coopPaymentEmails.has(email);
            
            if (hasUserIdPayment || hasEmailPayment) {
                revertedWithPayment++;
                toRestore.push({
                    docId: doc.id,
                    userId,
                    email,
                    paymentRef: hasUserIdPayment ? coopPaymentRefs.get(userId) : "email_match",
                    currentStatus: status
                });
            }
        }
    });

    console.log(`Currently Active/Approved: ${activeCount}`);
    console.log(`Currently Pending: ${pendingCount}`);
    console.log(`Pending members who actually HAVE a completed payment: ${revertedWithPayment}`);
    console.log(`\nSamples of pending but paid members (first 10):`);
    console.log(JSON.stringify(toRestore.slice(0, 10), null, 2));
}

main();
