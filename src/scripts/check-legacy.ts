import { db } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";

async function checkUsers() {
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    let legacySynced = 0;
    let paid = 0;
    
    usersSnap.forEach(doc => {
        const data = doc.data();
        const academy = data.serviceRegistrations?.academy;
        
        if (academy) {
            if (academy.syncedFromLegacy) legacySynced++;
            if (academy.paymentStatus === 'completed') paid++;
        }
    });

    console.log(`Paid users: ${paid}`);
    console.log(`Legacy synced users: ${legacySynced}`);
    process.exit(0);
}

checkUsers().catch(console.error);
