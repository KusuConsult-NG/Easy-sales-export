import { getAdminDb } from "./src/lib/firebase-admin";

async function run() {
  const adminDb = getAdminDb();
  
  const txns = await adminDb.collection("cooperative_transactions")
    .where("status", "==", "completed")
    .get();
  const seenUserIds = new Set<string>();
  
  txns.docs.forEach(doc => {
      const data = doc.data();
      if (data.type === "contribution" || data.type === "membership_registration" || data.type === "registration_fee") {
          if (data.userId) {
              seenUserIds.add(data.userId);
          }
      }
  });
  console.log("Unique users with registration/contribution in coop transactions:", seenUserIds.size);
}
run();
