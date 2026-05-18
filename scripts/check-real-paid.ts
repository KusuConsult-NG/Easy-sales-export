import { db } from "../src/lib/firebase-admin";

async function checkRealPaid() {
    const memSnap = await db.collection("cooperative_members").get();
    const paySnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const paidUserIds = new Set();
    paySnap.docs.forEach(doc => {
        if (doc.data().userId) paidUserIds.add(doc.data().userId);
    });
    
    let totalRealPaid = 0;
    
    memSnap.docs.forEach(doc => {
        const d = doc.data();
        const uid = d.userId || doc.id;
        if (d.paymentStatus === 'completed' || paidUserIds.has(uid)) {
            totalRealPaid++;
        }
    });
    
    console.log(`True Paid Members among Applications: ${totalRealPaid}`);
}
checkRealPaid();
