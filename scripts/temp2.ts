import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function run() {
  const mSnap = await db.collection("cooperative_members").where("paymentStatus", "==", "completed").get();
  
  const pSnap = await db.collection("processedPayments")
    .where("type", "==", "cooperative_membership_registration")
    .where("status", "==", "completed")
    .get();

  const paidUserIds = new Set<string>();
  pSnap.docs.forEach(d => {
    paidUserIds.add(d.data().userId);
  });

  console.log("Members with paymentStatus=completed:", mSnap.size);
  console.log("Valid Paystack Cooperative Payments:", pSnap.size);
  
  let invalidPaid = 0;
  const invalidUsers: string[] = [];

  mSnap.docs.forEach(doc => {
      const uid = doc.data().userId || doc.id;
      if (!paidUserIds.has(uid)) {
          invalidPaid++;
          invalidUsers.push(uid);
      }
  });

  console.log("Members marked paid WITHOUT Paystack payment:", invalidPaid);
  console.log(invalidUsers.slice(0, 10)); // just show a few
}

run();
