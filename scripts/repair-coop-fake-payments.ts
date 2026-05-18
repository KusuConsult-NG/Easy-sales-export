import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function run() {
  console.log("Fetching processed payments...");
  const pSnap = await db.collection("processedPayments")
    .where("type", "==", "cooperative_membership_registration")
    .where("status", "==", "completed")
    .get();

  const paidUserIds = new Set<string>();
  pSnap.docs.forEach(d => {
    paidUserIds.add(d.data().userId);
  });

  console.log("Valid Paystack Payments:", pSnap.size);
  console.log("Distinct Users Paid:", paidUserIds.size);

  console.log("Fetching cooperative members...");
  const mSnap = await db.collection("cooperative_members").where("paymentStatus", "==", "completed").get();
  
  let fixedCount = 0;
  const batch = db.batch();

  mSnap.docs.forEach(doc => {
      const uid = doc.data().userId || doc.id;
      if (!paidUserIds.has(uid)) {
          console.log(`User ${uid} marked as paid but NO Paystack payment found! Reverting to pending.`);
          batch.update(doc.ref, { paymentStatus: "pending" });
          fixedCount++;
      }
  });

  if (fixedCount > 0) {
      await batch.commit();
      console.log(`Successfully reverted ${fixedCount} fake payments to pending.`);
  } else {
      console.log("No fake payments found.");
  }
}

run();
