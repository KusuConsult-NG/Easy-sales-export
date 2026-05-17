import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const memberDocs = new Map(memSnap.docs.map(doc => [doc.data().userId || doc.id, doc.data()]));
    const paidUserIds = new Set(paymentsSnap.docs.map(doc => doc.data().userId).filter(Boolean));
    
    console.log(`memSnap.size: ${memSnap.size}`);
    console.log(`memberDocs unique keys: ${memberDocs.size}`);
    
    console.log(`paymentsSnap.size: ${paymentsSnap.size}`);
    console.log(`paidUserIds unique keys: ${paidUserIds.size}`);
    
    const allUserIds = new Set([...memberDocs.keys(), ...paidUserIds]);
    console.log(`allUserIds total unique union size: ${allUserIds.size}`);
}

run().catch(console.error).finally(() => process.exit(0));
