import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function run() {
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

    const activeOrApproved = allMembers.filter((m: any) =>
        m.membershipStatus === "active" || m.membershipStatus === "approved" ||
        m.status === "active" || m.status === "approved"
    );
    
    console.log("Total active/approved across ALL members:", activeOrApproved.length);

    const paidMembersList = allMembers.filter((m: any) => paidUserIds.has(m.userId) || paidUserIds.has(m.id));
    const activeMembers = paidMembersList.filter((m: any) =>
        m.membershipStatus === "active" || m.membershipStatus === "approved" ||
        m.status === "active" || m.status === "approved"
    ).length;

    console.log("Total active/approved within paidMembersList:", activeMembers);
    
    const paidButNotActiveOrApproved = paidMembersList.filter((m: any) =>
        m.membershipStatus !== "active" && m.membershipStatus !== "approved" &&
        m.status !== "active" && m.status !== "approved"
    );
    console.log("Paid members who are NOT active/approved:", paidButNotActiveOrApproved.length);
    if(paidButNotActiveOrApproved.length > 0) {
        console.log("Sample status:", paidButNotActiveOrApproved[0].membershipStatus);
    }
}
run().catch(console.error).finally(()=>process.exit(0));
