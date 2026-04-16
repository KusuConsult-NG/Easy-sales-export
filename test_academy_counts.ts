import { db } from "./src/lib/firebase-admin";

async function run() {
    const apps = await db.collection("academy_applications").count().get();
    console.log("Academy Apps:", apps.data().count);
}

run();
