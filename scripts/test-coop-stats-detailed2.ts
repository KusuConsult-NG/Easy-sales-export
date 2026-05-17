import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const paidUserIdsFromPayments = new Set(paymentsSnap.docs.map(doc => doc.data().userId));
    const memberUserIds = new Set(memSnap.docs.map(doc => doc.data().userId || doc.id));
    
    let paymentsWithoutMemberDoc = 0;
    paymentsSnap.docs.forEach(doc => {
        if (!memberUserIds.has(doc.data().userId)) {
            paymentsWithoutMemberDoc++;
        }
    });
    
    console.log(`Payments without member doc: ${paymentsWithoutMemberDoc}`);
}

run().catch(console.error).finally(() => process.exit(0));
