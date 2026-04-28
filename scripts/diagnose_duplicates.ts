import { db } from "../src/lib/firebase-admin";

const collections = [
    "seller_verifications",
    "academy_applications",
    "cooperative_members",
    "export_applications",
    "wave_applications"
];

async function run() {
    console.log("Checking for users with multiple applications...");
    
    for (const collName of collections) {
        console.log(`\n--- ${collName} ---`);
        const snap = await db.collection(collName).get();
        
        const userDocs: Record<string, any[]> = {};
        snap.docs.forEach(d => {
            const data = d.data();
            const userId = data.userId;
            if (userId) {
                if (!userDocs[userId]) userDocs[userId] = [];
                userDocs[userId].push({ id: d.id, ...data });
            }
        });
        
        for (const [userId, docs] of Object.entries(userDocs)) {
            if (docs.length > 1) {
                // sort by createdAt desc
                docs.sort((a, b) => {
                    const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                    const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                    return bTime - aTime;
                });
                
                const statuses = docs.map(d => d.status || d.membershipStatus);
                console.log(`User ${userId} has ${docs.length} docs. Statuses (newest first):`, statuses);
                
                // If an older doc is approved but newer is pending, that's a problem!
                const isOlderApproved = docs.slice(1).some(d => (d.status || d.membershipStatus) === 'approved');
                const isNewestPending = (docs[0].status || docs[0].membershipStatus) === 'pending';
                
                if (isOlderApproved && isNewestPending) {
                    console.log(`  🚨 WARNING: Older doc is approved but newest is pending!`);
                }
            }
        }
    }
}

run().catch(console.error);
