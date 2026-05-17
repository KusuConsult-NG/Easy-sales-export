import { db } from "../src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").where("userId", "==", "FFACISYjwxTswj5p36MdyE4nLG33").get();
    console.log(`cooperative_members docs for FFACISYjwxTswj5p36MdyE4nLG33: ${memSnap.size}`);
}

run().catch(console.error).finally(() => process.exit(0));
