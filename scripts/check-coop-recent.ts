// @ts-nocheck
import { db } from "../src/lib/firebase-admin";

async function run() {
    try {
        const sn = await db.collection('cooperative_members').get();
        const members = sn.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        let recentCount = 0;
        console.log("Recent registrations (Last 3 days):");
        for (const m of members as any[]) {
            if (m.createdAt) {
                const date = m.createdAt.toDate();
                if (date > new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)) {
                    if (m.paymentStatus === 'completed' || m.paymentStatus === 'paid') {
                           console.log(`- UserID: ${m.userId}, Status: ${m.status}, Payment Status: ${m.paymentStatus}, Date: ${date.toISOString()}`);
                           recentCount++;
                    }
                }
            }
        }
        console.log(`Total recent completed: ${recentCount}`);
    } catch (e) {
        console.error("Error", e);
    }
}
run();
