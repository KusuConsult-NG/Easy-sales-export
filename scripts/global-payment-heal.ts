import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function globalPaymentHeal() {
    console.log("Fetching all processed payments...");
    const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").get();
    
    const paymentsMap = new Map<string, any[]>();
    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.userId) return;
        if (!paymentsMap.has(data.userId)) {
            paymentsMap.set(data.userId, []);
        }
        paymentsMap.get(data.userId)!.push({ id: doc.id, ...data });
    });

    console.log(`Found ${paymentsSnap.docs.length} completed payments across ${paymentsMap.size} users.`);

    let batch = db.batch();
    let updates = 0;

    // Helper to check and update
    const checkAndUpdate = async (
        collection: string, 
        userId: string, 
        paymentData: any,
        createIfMissing: boolean = false
    ) => {
        const snap = await db.collection(collection).where("userId", "==", userId).limit(1).get();
        if (!snap.empty) {
            const doc = snap.docs[0];
            const data = doc.data();
            if (data.paymentStatus !== "completed") {
                batch.update(doc.ref, { 
                    paymentStatus: "completed", 
                    paymentReference: paymentData.reference,
                    updatedAt: new Date()
                });
                updates++;
                console.log(`[${collection}] Updated user ${userId} to completed.`);
            }
        } else if (createIfMissing) {
            // Create minimal application record
            const ref = db.collection(collection).doc();
            batch.set(ref, {
                userId,
                paymentStatus: "completed",
                status: "approved",
                paymentReference: paymentData.reference,
                createdAt: new Date(),
                updatedAt: new Date(),
                isMigrated: true
            });
            updates++;
            console.log(`[${collection}] Created missing application for user ${userId}.`);
        }
        
        if (updates >= 450) {
            await batch.commit();
            batch = db.batch();
            updates = 0;
            console.log("Committed batch...");
        }
    };

    for (const [userId, userPayments] of paymentsMap.entries()) {
        for (const payment of userPayments) {
            const type = (payment.type || payment.action || "").toLowerCase();
            const amount = Number(payment.amount || payment.registrationFee || 0);

            // Cooperative
            if (type.includes("coop") || type.includes("savings") || amount === 5000) {
                await checkAndUpdate(COLLECTIONS.COOPERATIVE_MEMBERS, userId, payment, true);
            }
            // Academy
            else if (type.includes("academy") || amount === 10000) {
                await checkAndUpdate(COLLECTIONS.ACADEMY_APPLICATIONS, userId, payment, true);
            }
            // Wave
            else if (type.includes("wave")) {
                await checkAndUpdate(COLLECTIONS.WAVE_APPLICATIONS, userId, payment, true);
            }
            // Export
            else if (type.includes("export")) {
                await checkAndUpdate(COLLECTIONS.EXPORT_APPLICATIONS, userId, payment, true);
            }
        }
    }

    if (updates > 0) {
        await batch.commit();
    }
    
    console.log("Global Payment Heal complete. All paid users should now have 'completed' status in their respective module applications.");
}

globalPaymentHeal().catch(console.error);
