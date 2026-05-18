import { db } from "../src/lib/firebase-admin";

async function checkPaymentTypes() {
    const paySnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    const typeCounts = new Map<string, number>();

    paySnap.docs.forEach(doc => {
        const p = doc.data();
        const typeStr = p.type || "MISSING_TYPE";
        typeCounts.set(typeStr, (typeCounts.get(typeStr) || 0) + 1);
    });

    console.log("Completed Payment Types:");
    for (const [type, count] of typeCounts.entries()) {
        console.log(`- ${type}: ${count}`);
    }
}

checkPaymentTypes().catch(console.error);
