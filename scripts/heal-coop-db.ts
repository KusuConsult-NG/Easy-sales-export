import { db } from "../src/lib/firebase-admin";

async function healDatabaseIntegrity() {
    console.log("Starting Database Integrity Heal (Mapping 10k/5k payments to Cooperative)...");

    // Fetch ALL completed payments
    const paySnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    // Filter down to the 519 confirmed payments for 10k and 5k
    const validPayments = paySnap.docs.filter(doc => {
        const p = doc.data();
        return p.amount === 10000 || p.amount === 1000000 || p.amount === 5000 || p.amount === 500000;
    });

    console.log(`Found ${validPayments.length} valid 10k/5k Paystack transactions.`);

    let updatedExisting = 0;
    let createdMissing = 0;

    const batch = db.batch();
    let batchCount = 0;

    for (const pDoc of validPayments) {
        const pData = pDoc.data();
        if (!pData.userId) continue;

        // Query the cooperative_members collection for this userId
        const memberQuery = await db.collection("cooperative_members")
            .where("userId", "==", pData.userId)
            .get();

        if (!memberQuery.empty) {
            // Document exists. Ensure paymentStatus is completed.
            const mDoc = memberQuery.docs[0];
            if (mDoc.data().paymentStatus !== "completed") {
                batch.update(mDoc.ref, { paymentStatus: "completed", updatedAt: new Date() });
                updatedExisting++;
                batchCount++;
            }
        } else {
            // ORPHANED PAYMENT: The user paid, but the application was never saved!
            // We must heal this by creating the missing application record.
            const newDocRef = db.collection("cooperative_members").doc();
            batch.set(newDocRef, {
                userId: pData.userId,
                paymentStatus: "completed",
                membershipStatus: "pending",
                status: "pending",
                registrationFee: pData.amount === 1000000 ? 10000 : (pData.amount === 500000 ? 5000 : pData.amount),
                createdAt: pData.createdAt || pData.processedAt || new Date(),
                updatedAt: new Date(),
                // Copy any email/phone if we had it in the payment metadata
                email: pData.customerEmail || pData.email || "",
                phone: pData.phone || "",
                _system_healed: true // Add an audit flag
            });
            createdMissing++;
            batchCount++;
        }

        if (batchCount >= 400) {
            await batch.commit();
            batchCount = 0;
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    console.log("--- HEAL COMPLETE ---");
    console.log(`Updated Existing Applications missing payment status: ${updatedExisting}`);
    console.log(`Created Missing Applications for Orphaned Payments: ${createdMissing}`);
}

healDatabaseIntegrity().catch(console.error);
