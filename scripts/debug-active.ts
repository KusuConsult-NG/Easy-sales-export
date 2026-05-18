import { db } from "../src/lib/firebase-admin";

async function run() {
    const [membersSnapR, paymentsSnapR] = await Promise.allSettled([
        db.collection('cooperative_members').limit(5000).get(),
        db.collection('processedPayments')
            .where('type', '==', 'cooperative_membership_registration')
            .where('status', '==', 'completed')
            .get()
    ]);

    const allMembers = membersSnapR.status === 'fulfilled'
        ? membersSnapR.value.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))
        : [];
    const paidUserIds = paymentsSnapR.status === 'fulfilled'
        ? new Set(paymentsSnapR.value.docs.map((doc: any) => doc.data().userId))
        : new Set();

    const activeOrApproved = allMembers.filter((m: any) =>
        m.membershipStatus === 'active' || m.membershipStatus === 'approved' ||
        m.status === 'active' || m.status === 'approved'
    );
    
    console.log('Total active/approved across ALL members:', activeOrApproved.length);

    const paidMembersList = allMembers.filter((m: any) => paidUserIds.has(m.userId) || paidUserIds.has(m.id));
    const activeMembers = paidMembersList.filter((m: any) =>
        m.membershipStatus === 'active' || m.membershipStatus === 'approved' ||
        m.status === 'active' || m.status === 'approved'
    ).length;

    console.log('Total active/approved within paidMembersList:', activeMembers);
}
run().catch(console.error).finally(()=>process.exit(0));
