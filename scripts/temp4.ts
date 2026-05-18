import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function run() {
  const pSnap = await db.collection("processedPayments")
    .get();

  let coopCount = 0;
  pSnap.docs.forEach(d => {
      const data = d.data();
      if ((data.module === "cooperative" || data.type?.includes("cooperative")) && data.status === "completed") {
          coopCount++;
      }
  });

  console.log("All completed cooperative-related payments:", coopCount);
}
run();
