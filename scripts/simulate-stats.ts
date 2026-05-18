import { getCooperativeStatsAction } from "../src/app/actions/cooperative-admin";
import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function run() {
    const adminScope = null; // simulate global admin
    
    const [membersSnapR, paymentsSnapR] = await Promise.allSettled([
        db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).limit(5000).get(),
        db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("type", "==", "cooperative_membership_registration")
            .where("status", "==", "completed")
            .get()
    ]);

    const allMembers = membersSnapR.status === "fulfilled"
        ? membersSnapR.value.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        : [];
    const paidUserIds = paymentsSnapR.status === "fulfilled"
        ? new Set(paymentsSnapR.value.docs.map(doc => doc.data().userId))
        : new Set();

    const paidMembersList = allMembers.filter((m: any) => paidUserIds.has(m.userId) || paidUserIds.has(m.id));
    const paidMembersCount = paidUserIds.size;
    
    const activeMembers = paidMembersList.filter((m: any) =>
        m.membershipStatus === "active" || m.membershipStatus === "approved" ||
        m.status === "active" || m.status === "approved"
    ).length;

    const pendingMembers = paidMembersCount - activeMembers; 
    const unpaidMembers = allMembers.length - paidMembersList.length;
    
    const totalMembersCount = paidMembersCount + unpaidMembers; 

    console.log("SIMULATED STATS PAYLOAD:");
    console.log({
        totalMembersCount,
        paidMembersCount,
        activeMembers,
        pendingMembers,
        unpaidMembers
    });
}
run().catch(console.error).finally(()=>process.exit(0));
