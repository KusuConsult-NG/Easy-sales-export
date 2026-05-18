import { db } from "../src/lib/firebase-admin";

async function checkAcademyConfusion() {
    // Let's get all Academy Applications
    const academyApps = await db.collection("academy_applications").get();
    const academyUserIds = new Set();
    academyApps.docs.forEach(doc => academyUserIds.add(doc.data().userId));
    
    console.log(`Total academy applications: ${academyApps.size}`);

    // Let's see how many of these users paid 10,000 for "cooperative_membership_registration"
    let academyUsersWith10kPayment = 0;
    
    // Process payments
    const payments = await db.collection("processedPayments").where("status", "==", "completed").get();
    let totalAcademyPaymentsInPayments = 0;
    
    payments.docs.forEach(doc => {
        const p = doc.data();
        if (p.type === "academy_registration" || p.type === "academy_course_purchase") {
            totalAcademyPaymentsInPayments++;
        }
        
        if (p.amount === 10000 && academyUserIds.has(p.userId)) {
            academyUsersWith10kPayment++;
        }
    });

    console.log(`Total academy payments tracked correctly (type=academy_*): ${totalAcademyPaymentsInPayments}`);
    console.log(`Users who applied for academy but their 10k payment might be tracked as cooperative: ${academyUsersWith10kPayment}`);
}

checkAcademyConfusion().catch(console.error);
