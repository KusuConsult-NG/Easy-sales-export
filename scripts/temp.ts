import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/lib/firebase-admin";

async function run() {
  const snap = await db.collection("processedPayments")
    .where("type", "==", "cooperative_membership_registration")
    .where("status", "==", "completed")
    .get();
  console.log("Completed Paystack cooperative payments:", snap.size);
  
  const mSnap = await db.collection("cooperative_members").where("paymentStatus", "==", "completed").get();
  console.log("Coop members with paymentStatus=completed:", mSnap.size);

  const mSnapTotal = await db.collection("cooperative_members").get();
  console.log("Total Coop members:", mSnapTotal.size);
}
run();
