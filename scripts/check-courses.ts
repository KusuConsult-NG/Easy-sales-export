import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function run() {
    const snap = await db.collection(COLLECTIONS.ACADEMY_COURSES).get();
    snap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`Course ${doc.id}: title=${data.title}, modules count=${data.modules?.length}`);
    });
}
run().catch(console.error);
