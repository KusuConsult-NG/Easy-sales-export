import { getCleanBroadcastList } from "../src/lib/broadcast-logic";
import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const memberDocs = new Map(memSnap.docs.map(doc => [doc.data().userId || doc.id, doc.data()]));
    const paidUserIds = new Set(paymentsSnap.docs.map(doc => doc.data().userId).filter(Boolean));
    const allUserIds = Array.from(new Set([...memberDocs.keys(), ...paidUserIds]));
    
    console.log(`Total Base Unique Users: ${allUserIds.length}`);
    
    let noEmailCount = 0;
    for (const uid of allUserIds) {
        let email = memberDocs.get(uid)?.email;
        if (!email) {
            const userDoc = await db.collection("users").doc(uid).get();
            if (userDoc.exists) {
                email = userDoc.data()?.email || userDoc.data()?.userEmail;
            }
        }
        if (!email) {
            // Check auth
            try {
                const { getAuth } = await import("firebase-admin/auth");
                const authUser = await getAuth().getUser(uid);
                email = authUser.email;
            } catch(e) {}
        }
        if (!email) noEmailCount++;
    }
    
    console.log(`Users with absolutely NO email anywhere in the system: ${noEmailCount}`);
    
    // Check for duplicate emails
    const emailSet = new Set();
    let duplicateEmails = 0;
    
    for (const uid of allUserIds) {
        let email = memberDocs.get(uid)?.email;
        if (!email) {
            const userDoc = await db.collection("users").doc(uid).get();
            if (userDoc.exists) email = userDoc.data()?.email || userDoc.data()?.userEmail;
        }
        if (email) {
            const normalized = email.toLowerCase().trim();
            if (emailSet.has(normalized)) {
                duplicateEmails++;
            }
            emailSet.add(normalized);
        }
    }
    console.log(`Users removed because their email is a DUPLICATE of another user: ${duplicateEmails}`);
}

run().catch(console.error).finally(() => process.exit(0));
