import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const paidUserIds = new Set(paymentsSnap.docs.map(doc => doc.data().userId));
    
    let unlinkedCompletedMembers = 0;
    memSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.paymentStatus === "completed" && !paidUserIds.has(d.userId) && !paidUserIds.has(doc.id)) {
            unlinkedCompletedMembers++;
            // Print one to investigate
            if (unlinkedCompletedMembers === 1) {
                console.log("Unlinked Completed Member:", doc.id, d);
            }
        }
    });
    console.log(`Members with paymentStatus='completed' but NO match in processedPayments: ${unlinkedCompletedMembers}`);
}

run().catch(console.error).finally(() => process.exit(0));
