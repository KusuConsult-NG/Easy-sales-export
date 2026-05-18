import { db } from "../src/lib/firebase-admin";

async function investigateAcademyPayments() {
    const apps = await db.collection("academy_applications").where("paymentStatus", "==", "completed").get();
    console.log(`Found ${apps.size} academy apps with completed payment.`);
    
    const userIds = [];
    apps.docs.forEach(doc => {
        userIds.push(doc.data().userId);
        console.log(`App User: ${doc.data().userId}, Plan: ${doc.data().plan}, amount: ${doc.data().paymentAmount}`);
    });
    
    console.log("Checking processedPayments for these users...");
    const payments = await db.collection("processedPayments").where("status", "==", "completed").get();
    
    payments.docs.forEach(doc => {
        const p = doc.data();
        if (userIds.includes(p.userId)) {
            console.log(`Found payment for user ${p.userId}: Type = ${p.type}, Amount = ${p.amount}, Date = ${p.createdAt?.toDate ? p.createdAt.toDate().toISOString() : p.createdAt}`);
        }
    });
}

investigateAcademyPayments().catch(console.error);
