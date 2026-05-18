import { db } from "../src/lib/firebase-admin";

async function checkPaymentAmounts() {
    const payments = await db.collection("processedPayments").where("status", "==", "completed").get();
    const amountCount: Record<number, number> = {};
    
    payments.docs.forEach(doc => {
        const p = doc.data();
        amountCount[p.amount] = (amountCount[p.amount] || 0) + 1;
    });

    console.log("All Payment Amounts:");
    console.table(amountCount);
}

checkPaymentAmounts().catch(console.error);
