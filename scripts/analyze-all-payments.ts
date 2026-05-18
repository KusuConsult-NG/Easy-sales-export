import { db } from "../src/lib/firebase-admin";

async function checkAllPayments() {
    const paySnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    console.log(`Total completed payments in DB: ${paySnap.docs.length}`);

    let coopPayments = 0;
    let academyPayments = 0;
    let otherPayments = 0;

    let tenKCount = 0;
    let fiveKCount = 0;

    paySnap.docs.forEach(doc => {
        const p = doc.data();
        if (p.amount === 10000 || p.amount === 1000000) { // sometimes amounts are in kobo (1,000,000)
            tenKCount++;
        }
        if (p.amount === 5000 || p.amount === 500000) {
            fiveKCount++;
        }

        if (p.type === "cooperative_membership_registration") {
            coopPayments++;
        } else if (p.type && p.type.includes("academy")) {
            academyPayments++;
        } else {
            otherPayments++;
        }
    });

    console.log(`Coop type: ${coopPayments}`);
    console.log(`Academy type: ${academyPayments}`);
    console.log(`Other type: ${otherPayments}`);
    console.log(`10k Payments: ${tenKCount}`);
    console.log(`5k Payments: ${fiveKCount}`);
}

checkAllPayments().catch(console.error);
