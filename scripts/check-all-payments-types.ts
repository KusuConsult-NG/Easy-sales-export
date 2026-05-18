import { db } from "../src/lib/firebase-admin";

async function checkPaymentTypes() {
    const payments = await db.collection("processedPayments").where("status", "==", "completed").get();
    const typeCount: Record<string, number> = {};
    const academyAmounts: Record<number, number> = {};
    
    payments.docs.forEach(doc => {
        const p = doc.data();
        typeCount[p.type] = (typeCount[p.type] || 0) + 1;
        
        if (p.type === "academy_registration" || p.type === "academy_course_purchase" || p.type === "academy") {
            academyAmounts[p.amount] = (academyAmounts[p.amount] || 0) + 1;
        }
    });

    console.log("Payment Types:");
    console.table(typeCount);
    
    console.log("Academy payment amounts:");
    console.table(academyAmounts);
    
    // Check if there are academy applications with paymentStatus == "completed"
    const academyApps = await db.collection("academy_applications").where("paymentStatus", "==", "completed").get();
    console.log(`Academy applications with paymentStatus == "completed": ${academyApps.size}`);
    
    const academyAppsPaid = await db.collection("academy_applications").where("paymentStatus", "==", "paid").get();
    console.log(`Academy applications with paymentStatus == "paid": ${academyAppsPaid.size}`);
}

checkPaymentTypes().catch(console.error);
