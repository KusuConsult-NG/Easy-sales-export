import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const paidEmails = new Set(paymentsSnap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean));
    const paidPhones = new Set(paymentsSnap.docs.map(doc => doc.data().phone).filter(Boolean));
    const paidUserIds = new Set(paymentsSnap.docs.map(doc => doc.data().userId).filter(Boolean));
    
    let matchedById = 0;
    let matchedByEmail = 0;
    let matchedByPhone = 0;
    let totalMatched = 0;

    memSnap.docs.forEach(doc => {
        const d = doc.data();
        let matched = false;
        
        if (paidUserIds.has(d.userId)) {
            matchedById++;
            matched = true;
        } else if (d.email && paidEmails.has(d.email.toLowerCase())) {
            matchedByEmail++;
            matched = true;
        } else if (d.phone && paidPhones.has(d.phone)) {
            matchedByPhone++;
            matched = true;
        }
        
        if (matched) totalMatched++;
    });
    
    console.log(`Total completed payments: ${paymentsSnap.size}`);
    console.log(`Matched by ID: ${matchedById}`);
    console.log(`Matched by Email (fallback): ${matchedByEmail}`);
    console.log(`Matched by Phone (fallback): ${matchedByPhone}`);
    console.log(`Total uniquely matched members: ${totalMatched}`);
}

run().catch(console.error).finally(() => process.exit(0));
