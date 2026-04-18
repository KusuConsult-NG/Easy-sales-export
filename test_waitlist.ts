import * as dotenv from "dotenv";
dotenv.config({ path: "./.env.local" });
import { db } from "./src/lib/firebase-admin";

async function countWaitlist() {
  try {
    const collections = await db.listCollections();
    const collNames = collections.map(c => c.id);
    
    if (collNames.includes("waitlist")) {
      const snap = await db.collection("waitlist").get();
      console.log("WAITLIST_TOTAL=" + snap.docs.length);
    } else if (collNames.includes("waitlists")) {
      const snap = await db.collection("waitlists").get();
      console.log("WAITLISTS_TOTAL=" + snap.docs.length);
    } else {
      console.log("No waitlist collection found. Available collections:", collNames.join(", "));
    }
  } catch (error) {
    console.error("Firebase error", error);
  }
}
countWaitlist();
