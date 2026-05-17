import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").limit(1).get();
    console.log(memSnap.docs[0].data());
}

run().catch(console.error).finally(() => process.exit(0));
