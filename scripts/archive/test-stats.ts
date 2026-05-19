import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "./src/lib/firebase-admin";

async function main() {
    const snap = await db.collection("cooperative_members")
        .select("userId", "membershipStatus", "status", "paymentStatus")
        .get();

    let total = snap.docs.length;
    let paid = 0;
    
    snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.paymentStatus === 'completed') {
            paid++;
        }
    });

    console.log(`Total members from select query: ${total}`);
    console.log(`Paid members from select query: ${paid}`);
    
    // Check pending
    let pending = 0;
    snap.docs.forEach(doc => {
        const m = doc.data();
        const isActive = m.membershipStatus === "active" || m.membershipStatus === "approved" ||
                         m.status === "active" || m.status === "approved";
        const isSuspended = m.membershipStatus === "suspended" || m.status === "suspended";
        if (isActive || isSuspended) return;
        
        if (m.membershipStatus === "pending" || m.status === "pending" || (!m.membershipStatus && !m.status)) {
            pending++;
        }
    });
    console.log(`Pending members: ${pending}`);
    
    let active = 0;
    snap.docs.forEach(doc => {
        const m = doc.data();
        if (m.membershipStatus === "active" || m.membershipStatus === "approved" ||
                         m.status === "active" || m.status === "approved") {
            active++;
        }
    });
    console.log(`Active members: ${active}`);
}

main().catch(console.error);
