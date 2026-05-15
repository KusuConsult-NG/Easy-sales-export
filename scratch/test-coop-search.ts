import { getAdminDb } from "./src/lib/firebase-admin";

async function run() {
    try {
        const db = getAdminDb();
        const search = "admin";
        const fetchLimit = 5000;
        
        let q: FirebaseFirestore.Query = db.collection("cooperative_members");
        q = q.orderBy("createdAt", "desc");
        q = q.limit(fetchLimit);

        console.log("Executing query...");
        const snapshot = await q.get();
        console.log(`Fetched ${snapshot.size} members`);

        // Get users
        const userIds = [...new Set(snapshot.docs.map(doc => doc.data().userId).filter(Boolean))];
        console.log(`Found ${userIds.length} unique user IDs`);
        
    } catch (e: any) {
        console.log("Error:", e.message);
    }
    process.exit(0);
}
run();
