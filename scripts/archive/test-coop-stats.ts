import { getAdminDb } from "./src/lib/firebase-admin";

async function run() {
  const adminDb = getAdminDb();
  
  const membersSnap = await adminDb.collection("cooperative_members").get();
  const allMembers = membersSnap.docs.map(d => ({id: d.id, ...d.data()}));
  
  const txns = await adminDb.collection("cooperative_transactions")
    .where("status", "==", "completed")
    .get();
  
  const paidUserIds = new Set<string>();
  txns.docs.forEach(doc => {
      const data = doc.data();
      if (data.type === "contribution" || data.type === "membership_registration" || data.type === "registration_fee") {
          if (data.userId) paidUserIds.add(data.userId);
      }
  });
  
  const activeMembersCount = allMembers.filter((m: any) =>
      m.membershipStatus === "active" || m.membershipStatus === "approved" ||
      m.status === "active" || m.status === "approved"
  ).length;

  const paidMembersCount = paidUserIds.size;
  const pendingMembers = Math.max(0, paidMembersCount - activeMembersCount);
  
  const unpaidMembersCount = allMembers.filter((m: any) => !paidUserIds.has(m.userId) && !paidUserIds.has(m.id)).length;
  
  const totalApps = allMembers.length;
  
  console.log({
     paidMembersCount,
     activeMembersCount,
     pendingMembers,
     unpaidMembersCount,
     totalApps
  });
}
run();
