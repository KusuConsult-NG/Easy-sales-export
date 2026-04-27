import { db } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";
import * as fs from 'fs';

async function runAudit() {
    console.log("Starting audit...");
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    let bypassedCount = 0;
    const bypassedUsers: any[] = [];

    usersSnap.forEach(doc => {
        const data = doc.data();
        const academy = data.serviceRegistrations?.academy;
        
        // If they have academy status but NO paymentStatus === 'completed'
        if (academy && academy.status) {
            if (academy.paymentStatus !== 'completed') {
                bypassedCount++;
                bypassedUsers.push({
                    id: doc.id,
                    email: data.email,
                    status: academy.status,
                    paymentStatus: academy.paymentStatus || 'missing',
                    plan: academy.plan || 'missing'
                });
            }
        }
    });

    console.log(`Total users with Academy registration: ${usersSnap.docs.filter(d => d.data().serviceRegistrations?.academy).length}`);
    console.log(`Total users who bypassed payment: ${bypassedCount}`);
    
    fs.writeFileSync('scratch/academy_unpaid_report.json', JSON.stringify(bypassedUsers, null, 2));
    console.log("Report saved to scratch/academy_unpaid_report.json");
    process.exit(0);
}

runAudit().catch(console.error);
