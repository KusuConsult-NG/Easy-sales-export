import { db } from "../src/lib/firebase-admin";

async function run() {
    const doc1 = await db.collection("users").doc("01JzdDTkFshvzzzZ8x94SDqEqda2").get();
    const doc2 = await db.collection("users").doc("02cbbaa8-6192-4b2c-9ceb-cac582e1c408").get();
    console.log("01Jzd... exists:", doc1.exists);
    console.log("02cbbaa8... exists:", doc2.exists);
}

run().catch(console.error).finally(() => process.exit(0));
