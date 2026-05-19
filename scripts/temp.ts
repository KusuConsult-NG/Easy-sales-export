import { config } from "dotenv";
config({ path: ".env.local" });
import { getAdminDb } from "../src/lib/firebase-admin";

async function run() {
  const db = getAdminDb();
  const snap = await db.collection("cooperative_members").limit(5).get();
  snap.docs.forEach(doc => {
    console.log("Doc ID:", doc.id);
    console.log("userId inside doc:", doc.data().userId);
  });
}
run();
