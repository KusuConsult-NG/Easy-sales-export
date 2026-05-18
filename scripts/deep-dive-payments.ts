import { db } from "../src/lib/firebase-admin";

async function deepDivePayments() {
    const paySnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    let countQueryMatch = 0;
    let countCodeMatch = 0;

    paySnap.docs.forEach(doc => {
        const p = doc.data();
        if (p.type === "cooperative_membership_registration") countCodeMatch++;
    });

    const querySnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    countQueryMatch = querySnap.docs.length;

    console.log(`Code match: ${countCodeMatch}`);
    console.log(`Query match: ${countQueryMatch}`);

    const all10kOr5k = paySnap.docs.filter(doc => {
        const p = doc.data();
        return p.amount === 10000 || p.amount === 1000000 || p.amount === 5000 || p.amount === 500000;
    });
    console.log(`Total payments with 10k or 5k amount: ${all10kOr5k.length}`);
}

deepDivePayments().catch(console.error);
