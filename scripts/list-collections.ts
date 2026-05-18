import { db } from "../src/lib/firebase-admin";

async function exploreCollections() {
    const collections = await db.listCollections();
    console.log("All collections in Firebase:");
    collections.forEach(c => console.log(c.id));
}

exploreCollections().catch(console.error);
