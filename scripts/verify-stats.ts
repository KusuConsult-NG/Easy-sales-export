import { db } from "../src/lib/firebase-admin";

async function verify() {
  const members = await db.collection("cooperative_members").get();
  console.log(`Total Members: ${members.size}`);
  
  let pending = 0;
  let approved = 0;
  let other = 0;
  let paid = 0;
  let unpaid = 0;
  
  const payments = await db.collection("processedPayments")
    .where("type", "==", "cooperative_membership_registration")
    .where("status", "==", "completed")
    .get();
  
  console.log(`Total Completed Payments: ${payments.size}`);
  const paidUserIds = new Set<string>();
  payments.docs.forEach(d => {
    if (d.data().userId) paidUserIds.add(d.data().userId);
  });
  
  members.docs.forEach(doc => {
    const data = doc.data();
    if (data.membershipStatus === "pending" || data.status === "pending" || (!data.membershipStatus && !data.status)) {
      pending++;
    } else if (data.membershipStatus === "active" || data.membershipStatus === "approved" || data.status === "active" || data.status === "approved") {
      approved++;
    } else {
      other++;
    }
    
    if (paidUserIds.has(data.userId) || paidUserIds.has(doc.id)) {
      paid++;
    } else {
      unpaid++;
    }
  });
  
  console.log(`Pending: ${pending}, Approved: ${approved}, Other: ${other}`);
  console.log(`Paid (intersection): ${paid}, Unpaid: ${unpaid}`);
}

verify().catch(console.error).finally(() => process.exit(0));
