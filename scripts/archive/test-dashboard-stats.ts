import { db } from "./src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").select("userId", "membershipStatus", "status").get();
    const paySnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .select("userId")
        .get();
        
    const paidUserIds = new Set();
    paySnap.docs.forEach(d => paidUserIds.add(d.data().userId));
    
    memSnap.docs.forEach(doc => {
        const m = doc.data();
        const isActive = m.membershipStatus === "active" || m.membershipStatus === "approved" || m.status === "active" || m.status === "approved";
        if (isActive) paidUserIds.add(m.userId || doc.id);
    });
    
    let active = 0;
    let pending = 0;
    
    memSnap.docs.forEach(doc => {
        const m = doc.data();
        const isActive = m.membershipStatus === "active" || m.membershipStatus === "approved" || m.status === "active" || m.status === "approved";
        if (isActive) { active++; return; }
        
        pending++;
    });
    
    console.log(`Active/Approved: ${active}`);
    console.log(`Pending: ${pending}`);
    console.log(`Paid size: ${paidUserIds.size}`);
    console.log(`Total apps: ${memSnap.docs.length}`);
}
run();
