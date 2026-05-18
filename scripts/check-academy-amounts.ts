import { db } from "../src/lib/firebase-admin";

async function checkAcademyPayments() {
    const paySnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    let count25 = 0;
    let count50 = 0;
    let count100 = 0;

    paySnap.docs.forEach(doc => {
        const p = doc.data();
        if (p.amount === 25000 || p.amount === 2500000) count25++;
        if (p.amount === 50000 || p.amount === 5000000) count50++;
        if (p.amount === 100000 || p.amount === 10000000) count100++;
    });

    console.log(`25k: ${count25}`);
    console.log(`50k: ${count50}`);
    console.log(`100k: ${count100}`);
}

checkAcademyPayments().catch(console.error);
