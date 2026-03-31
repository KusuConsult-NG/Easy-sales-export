import { getAdminDb } from "../src/lib/firebase-admin";

async function run() {
    const db = getAdminDb();
    const snap = await db.collection("failedPayments").get();
    
    const uniqueUserIds = new Set<string>();
    const uniqueCustomerEmails = new Set<string>();

    snap.docs.forEach(d => {
        const data = d.data();
        if (data.userId) uniqueUserIds.add(data.userId);
        if (data.customerEmail) uniqueCustomerEmails.add(data.customerEmail);
    });

    console.log(`Unique userIds: ${uniqueUserIds.size}`);
    console.log(`Unique customerEmails: ${uniqueCustomerEmails.size}`);

    // Let's resolve the user records for the unique userIds to see how many have emails
    const compact = Array.from(uniqueUserIds);
    let userEmails = 0;
    
    for (let i = 0; i < compact.length; i += 100) {
        const batch = compact.slice(i, i + 100).map(id => db.collection("users").doc(id));
        if (batch.length === 0) continue;
        const snaps = await db.getAll(...batch);
        for (const userSnap of snaps) {
            if (userSnap.exists) {
                const u = userSnap.data();
                if (u && (u.email || u.emailAddress)) {
                    userEmails++;
                }
            }
        }
    }
    
    console.log(`Unique users with emails in DB: ${userEmails}`);
}

run().catch(console.error);
