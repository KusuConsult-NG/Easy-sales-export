import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function run() {
  const pSnap = await db.collection("processedPayments")
    .where("type", "==", "cooperative_membership_registration")
    .get();

  console.log("All Paystack Cooperative Payments:", pSnap.size);
  
  let completed = 0;
  let others = 0;
  pSnap.docs.forEach(d => {
    if (d.data().status === 'completed' || d.data().status === 'success') {
        completed++;
    } else {
        others++;
    }
  });

  console.log("Completed/Success:", completed);
  console.log("Others:", others);

  const pSnap2 = await db.collection("processedPayments")
    .where("type", "in", ["cooperative_membership_registration", "cooperative_registration"])
    .get();
    
  console.log("Variations of type count:", pSnap2.size);
}
run();
