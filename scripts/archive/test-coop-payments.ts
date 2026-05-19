import { getAdminDb } from "./src/lib/firebase-admin";

async function run() {
  const adminDb = getAdminDb();
  const snaps = await adminDb.collection("processedPayments")
    .where("status", "==", "completed")
    .get();

  const types: Record<string, number> = {};
  snaps.docs.forEach(doc => {
    const data = doc.data();
    if (data.type?.includes("coop") || data.moduleId === "cooperatives") {
       types[data.type] = (types[data.type] || 0) + 1;
    }
  });
  console.log("Coop related completed payments (processedPayments):", types);
  
  const allCoop = await adminDb.collection("processedPayments")
    .where("type", "==", "cooperative_membership_registration")
    .where("status", "==", "completed")
    .get();
  console.log("cooperative_membership_registration count (processedPayments):", allCoop.size);

  const txns = await adminDb.collection("cooperative_transactions")
    .where("status", "==", "completed")
    .get();
  const txTypes: Record<string, number> = {};
  txns.docs.forEach(doc => {
      const data = doc.data();
      txTypes[data.type] = (txTypes[data.type] || 0) + 1;
  });
  console.log("Coop transactions counts:", txTypes);
}
run();
