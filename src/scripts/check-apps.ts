import { db } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";

async function checkApps() {
    const appsSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).get();
    let legacyPaid = 0;
    
    for (const doc of appsSnap.docs) {
        const data = doc.data();
        if (data.paymentStatus === 'completed' || data.paymentReference) {
            const userId = data.userId;
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const userData = userDoc.data();
            if (userData?.serviceRegistrations?.academy?.paymentStatus !== 'completed') {
                legacyPaid++;
                console.log(`User ${userId} paid in applications but not in users collection!`);
            }
        }
    }

    console.log(`Total legacy paid missing in users: ${legacyPaid}`);
    process.exit(0);
}

checkApps().catch(console.error);
