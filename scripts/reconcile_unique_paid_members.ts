import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing unique Cooperative Members vs Payments...");

    // 1. Fetch completed cooperative payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    // Set of payment references
    const paymentRefs = new Set<string>();
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

            paymentRefs.add(ref);
            if (userId) {
                paymentByUserId.set(userId, paymentInfo);
            }
            if (email) {
                paymentByEmail.set(email.toLowerCase().trim(), paymentInfo);
            }
        }
    });

    console.log(`Loaded ${paymentRefs.size} unique completed cooperative payments from processedPayments.`);

    // 2. Fetch all cooperative members
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Total cooperative members in DB: ${coopSnap.size}`);

    // Map of userId -> array of member docs
    const userMembers = new Map<string, any[]>();
    coopSnap.docs.forEach(doc => {
        const member = doc.data();
        const userId = member.userId || doc.id;
        if (!userMembers.has(userId)) {
            userMembers.set(userId, []);
        }
        userMembers.get(userId)!.push({ docId: doc.id, ...member });
    });

    console.log(`Total unique userIds in cooperative_members: ${userMembers.size}`);

    // Reconcile status at the user level
    let activePaidUsers = 0;
    let activeLegacyUsers = 0;
    let activeManualUsers = 0;
    let activeUnpaidUsers = 0;

    let pendingPaidUsers = 0;
    let pendingUnpaidUsers = 0;

    const activeUnpaidSample: any[] = [];
    const pendingPaidSample: any[] = [];

    for (const [userId, docs] of userMembers.entries()) {
        // A user is considered active if ANY of their documents are active
        const activeDoc = docs.find(d => d.status === "active" || d.status === "approved" || d.membershipStatus === "active" || d.membershipStatus === "approved");
        
        const isLegacy = docs.some(d => 
            d._importSource === "legacy_csv_import" || 
            d.isLegacy === true || 
            d.legacyOnboardedBy || 
            d.paymentReference === "LEGACY_IMPORT_RECEIPT"
        );

        const isManual = docs.some(d => 
            d.approvedBy || 
            d.approvedAt || 
            d.healedByScript
        );

        // Check if user has a matching payment
        const payInfoByUserId = paymentByUserId.get(userId);
        
        // Find if any doc has a paymentReference in completed payments
        let payInfoByRef: any = null;
        for (const d of docs) {
            if (d.paymentReference && paymentRefs.has(d.paymentReference)) {
                payInfoByRef = paymentByUserId.get(userId) || { reference: d.paymentReference };
                break;
            }
        }

        // Find if any doc email has a payment
        let payInfoByEmail: any = null;
        for (const d of docs) {
            const email = (d.email || "").toLowerCase().trim();
            if (email && paymentByEmail.has(email)) {
                payInfoByEmail = paymentByEmail.get(email);
                break;
            }
        }

        const matchedPayment = payInfoByRef || payInfoByUserId || payInfoByEmail;

        if (activeDoc) {
            if (matchedPayment) {
                activePaidUsers++;
            } else if (isLegacy) {
                activeLegacyUsers++;
            } else if (isManual) {
                activeManualUsers++;
            } else {
                activeUnpaidUsers++;
                activeUnpaidSample.push({ userId, docs: docs.map(d => ({ docId: d.docId, status: d.status, ref: d.paymentReference })) });
            }
        } else {
            // No active document for this user (they are pending/rejected)
            if (matchedPayment) {
                pendingPaidUsers++;
                pendingPaidSample.push({
                    userId,
                    paymentRef: matchedPayment.reference,
                    paymentAmount: matchedPayment.amount,
                    docs: docs.map(d => ({ docId: d.docId, status: d.status, ref: d.paymentReference }))
                });
            } else {
                pendingUnpaidUsers++;
            }
        }
    }

    console.log(`\nUser-Level Reconciliation Summary:`);
    console.log(`Active Users Breakdown:`);
    console.log(`- Paid: ${activePaidUsers}`);
    console.log(`- Legacy: ${activeLegacyUsers}`);
    console.log(`- Manual: ${activeManualUsers}`);
    console.log(`- Active but NO payment record: ${activeUnpaidUsers}`);
    if (activeUnpaidUsers > 0) {
        console.log(`  Sample active but unpaid users:`, JSON.stringify(activeUnpaidSample.slice(0, 5), null, 2));
    }

    console.log(`\nPending Users Breakdown:`);
    console.log(`- Paid: ${pendingPaidUsers}`);
    console.log(`- Unpaid: ${pendingUnpaidUsers}`);
    if (pendingPaidUsers > 0) {
        console.log(`  Sample pending but paid users:`, JSON.stringify(pendingPaidSample.slice(0, 5), null, 2));
    }
}

main();
