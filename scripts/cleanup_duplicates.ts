import { db } from "../src/lib/firebase-admin";

const collections = [
    "seller_verifications",
    "academy_applications",
    "cooperative_members",
    "export_applications",
    "wave_applications"
];

async function run() {
    console.log("Cleaning up duplicate applications...");
    
    for (const collName of collections) {
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
                docs.sort((a, b) => {
                    const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                    const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                    return bTime - aTime;
                });
                
                // Keep the newest (index 0)
                const docsToDelete = docs.slice(1);
                console.log(`User ${userId} in ${collName} has ${docs.length} docs. Keeping newest, deleting ${docsToDelete.length} older docs...`);
                
                for (const doc of docsToDelete) {
                    await db.collection(collName).doc(doc.id).delete();
                    console.log(`  Deleted doc ${doc.id}`);
                }
            }
        }
    }
    console.log("Cleanup complete!");
}

run().catch(console.error);
