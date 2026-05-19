import { config } from "dotenv";
config({ path: ".env.local" });
import { getAdminDb } from "./src/lib/firebase-admin";

async function checkFirestoreUser(uid: string) {
  try {
    const db = getAdminDb();
    const doc = await db.collection("users").doc(uid).get();
    if (doc.exists) {
      console.log(`Firestore User ${uid}:`, doc.data());
    } else {
      console.log(`Firestore User ${uid} NOT FOUND`);
    }
  } catch (e: any) {
    console.error(`Error for ${uid}: ${e.message}`);
  }
}

checkFirestoreUser("fiIid9Vl9YXXLCpjDN0UqvtfBWh2");
