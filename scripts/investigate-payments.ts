import { db } from "../src/lib/firebase-admin";

async function investigatePayments() {
    const memSnap = await db.collection("cooperative_members").get();
    const memEmails = new Map();
    const memPhones = new Map();
    const memUserIds = new Set();
    
    memSnap.docs.forEach(doc => {
        const d = doc.data();
        const uid = d.userId || doc.id;
        memUserIds.add(uid);
        if (d.email) memEmails.set(d.email.toLowerCase().trim(), uid);
        if (d.phone) memPhones.set(d.phone.trim(), uid);
    });

    const paySnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    let exactUserIdMatch = 0;
    let emailMatch = 0;
    let noMatch = 0;
    
    paySnap.docs.forEach(doc => {
        const p = doc.data();
        if (memUserIds.has(p.userId)) {
            exactUserIdMatch++;
        } else {
            let matchedByEmail = false;
            if (p.customerEmail && memEmails.has(p.customerEmail.toLowerCase().trim())) {
                matchedByEmail = true;
            } else if (p.email && memEmails.has(p.email.toLowerCase().trim())) {
                matchedByEmail = true;
            }
            
            if (matchedByEmail) {
                emailMatch++;
            } else {
                noMatch++;
                if (noMatch < 3) console.log("Example orphaned payment:", p);
            }
        }
    });
    
    console.log(`Total payments: ${paySnap.docs.length}`);
    console.log(`Exact userId match: ${exactUserIdMatch}`);
    console.log(`Email match but NO userId match: ${emailMatch}`);
    console.log(`Total truly orphaned: ${noMatch}`);
}

investigatePayments();
