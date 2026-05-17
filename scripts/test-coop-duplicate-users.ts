import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    const userIds = new Set();
    let duplicates = 0;
    memSnap.docs.forEach(doc => {
        const uid = doc.data().userId || doc.id;
        if (userIds.has(uid)) {
            duplicates++;
        }
        userIds.add(uid);
    });
    console.log(`Duplicate users in cooperative_members: ${duplicates}`);
}

run().catch(console.error).finally(() => process.exit(0));
