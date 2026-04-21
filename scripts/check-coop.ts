import { db } from "../src/lib/firebase-admin";

async function run() {
    try {
        const sn = await db.collection('cooperative_members').get();
        const members = sn.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`Total cooperative members: ${members.length}`);
        
        for (const m of members) {
            console.log(`- UserID: ${m.userId}`);
            console.log(`  Name: ${m.fullName || m.firstName + ' ' + m.lastName}`);
            console.log(`  Status: ${m.status}`);
            console.log(`  Payment Status: ${m.paymentStatus || 'Unknown'}`);
            console.log(`  Imported?: ${m._importSource || 'No'}`);
            console.log(`  Created At: ${m.createdAt ? m.createdAt.toDate().toISOString() : 'Unknown'}`);
        }
    } catch (e) {
        console.error("Error", e);
    }
}
run();
