import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing all Cooperative Members vs Payments...");

    // 1. Fetch completed cooperative payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    // Map of paymentReference -> payment details
    const paymentByRef = new Map<string, any>();
    // Map of userId -> payment details
    const paymentByUserId = new Map<string, any>();
    // Map of email -> payment details
    const paymentByEmail = new Map<string, any>();

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        
        const isCoop = type === "cooperative_membership_registration" || 
                       type === "cooperative" || 
                       String(data.purpose).includes("cooperative") ||
                       String(data.metadata?.purpose).includes("cooperative");
        
        if (isCoop || type === "unknown") {
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

            paymentByRef.set(ref, paymentInfo);
            if (userId) {
                paymentByUserId.set(userId, paymentInfo);
            }
            if (email) {
                paymentByEmail.set(email.toLowerCase().trim(), paymentInfo);
            }
        }
    });

    console.log(`Loaded ${paymentByRef.size} unique references from completed payments.`);

    // 2. Fetch all cooperative members
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Total cooperative members in DB: ${coopSnap.size}`);

    let activePaid = 0;
    let activeLegacy = 0;
    let activeManual = 0;
    let activeNoPayment = 0;

    let pendingPaid = 0;
    let pendingUnpaid = 0;

    const activeNoPaymentSample: any[] = [];
    const pendingPaidSample: any[] = [];

    coopSnap.docs.forEach(doc => {
        const member = doc.data();
        const userId = member.userId || doc.id;
        const email = (member.email || "").toLowerCase().trim();
        const ref = member.paymentReference;
        const status = member.status || member.membershipStatus || "pending";
        const isActive = status === "active" || status === "approved";

        // Check legacy/manual
        const isLegacy = 
            member._importSource === "legacy_csv_import" || 
            member.isLegacy === true || 
            member.legacyOnboardedBy || 
            member.paymentReference === "LEGACY_IMPORT_RECEIPT";

        const isManual = 
            member.approvedBy || 
            member.approvedAt || 
            member.healedByScript;

        // Check if there is a payment matching ref, userId, or email
        const payInfoByRef = ref ? paymentByRef.get(ref) : null;
        const payInfoByUserId = userId ? paymentByUserId.get(userId) : null;
        const payInfoByEmail = email ? paymentByEmail.get(email) : null;
        const matchedPayment = payInfoByRef || payInfoByUserId || payInfoByEmail;

        if (isActive) {
            if (matchedPayment) {
                activePaid++;
            } else if (isLegacy) {
                activeLegacy++;
            } else if (isManual) {
                activeManual++;
            } else {
                activeNoPayment++;
                activeNoPaymentSample.push({
                    docId: doc.id,
                    userId,
                    email,
                    ref,
                    status
                });
            }
        } else {
            // Pending/other
            if (matchedPayment) {
                pendingPaid++;
                pendingPaidSample.push({
                    docId: doc.id,
                    userId,
                    email,
                    ref,
                    status,
                    paymentRef: matchedPayment.reference,
                    paymentAmount: matchedPayment.amount
                });
            } else {
                pendingUnpaid++;
            }
        }
    });

    console.log(`\nActive Members breakdown:`);
    console.log(`- Paid: ${activePaid}`);
    console.log(`- Legacy: ${activeLegacy}`);
    console.log(`- Manual: ${activeManual}`);
    console.log(`- Active but NO payment record: ${activeNoPayment}`);
    if (activeNoPaymentSample.length > 0) {
        console.log(`  Sample active no-payment:`, activeNoPaymentSample.slice(0, 5));
    }

    console.log(`\nPending Members breakdown:`);
    console.log(`- Paid: ${pendingPaid}`);
    console.log(`- Unpaid: ${pendingUnpaid}`);
    
    console.log(`\nSample of Pending but Paid members:`, pendingPaidSample.slice(0, 10));
}

main();
