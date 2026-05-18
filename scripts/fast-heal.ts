import { db } from "../src/lib/firebase-admin";

async function fastHeal() {
    console.log("Starting FAST Heal...");

    const paySnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    const validPayments = paySnap.docs.filter(doc => {
        const p = doc.data();
        return p.amount === 10000 || p.amount === 1000000 || p.amount === 5000 || p.amount === 500000;
    });

    console.log(`Found ${validPayments.length} valid 10k/5k Paystack transactions.`);

    // Pre-fetch all members to avoid 519 individual queries
    const memSnap = await db.collection("cooperative_members").get();
    const memMap = new Map();
    memSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.userId) memMap.set(d.userId, doc);
        else memMap.set(doc.id, doc);
    });

    let updatedExisting = 0;
    let createdMissing = 0;
    const batch = db.batch();
    let batchCount = 0;

    for (const pDoc of validPayments) {
        const pData = pDoc.data();
        if (!pData.userId) continue;

        const mDoc = memMap.get(pData.userId);

        if (mDoc) {
            if (mDoc.data().paymentStatus !== "completed") {
                batch.update(mDoc.ref, { paymentStatus: "completed", updatedAt: new Date() });
                updatedExisting++;
                batchCount++;
            }
        } else {
            const newDocRef = db.collection("cooperative_members").doc();
            batch.set(newDocRef, {
                userId: pData.userId,
                paymentStatus: "completed",
                membershipStatus: "pending",
                status: "pending",
                registrationFee: pData.amount === 1000000 ? 10000 : (pData.amount === 500000 ? 5000 : pData.amount),
                createdAt: pData.createdAt || pData.processedAt || new Date(),
                updatedAt: new Date(),
                email: pData.customerEmail || pData.email || "",
                phone: pData.phone || "",
                _system_healed: true
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

    console.log("--- FAST HEAL COMPLETE ---");
    console.log(`Updated Existing Applications missing payment status: ${updatedExisting}`);
    console.log(`Created Missing Applications for Orphaned Payments: ${createdMissing}`);
    process.exit(0);
}

fastHeal().catch(e => { console.error(e); process.exit(1); });
