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

    // 1. Total Paid Payments (from processedPayments)
    const paidMembersCount = paidUserIds.size; // 441

    // 2. Unpaid Members (in cooperative_members but no payment record)
    const paidMembersList = allMembers.filter((m: any) => paidUserIds.has(m.userId) || paidUserIds.has(m.id));
    const unpaidMembers = allMembers.length - paidMembersList.length; // 582 - 208 = 374

    // 3. Total Members (paid payments + unpaid members) - per user requirement
    const totalMembersCount = paidMembersCount + unpaidMembers; // 441 + 374 = 815

    // 4. Active / Approved Members - Count EVERYONE who is approved, not just those with payment records
    const activeMembers = allMembers.filter((m: any) =>
        m.membershipStatus === 'active' || m.membershipStatus === 'approved' ||
        m.status === 'active' || m.status === 'approved'
    ).length; // 175

    // 5. Pending Members - Total Paid minus those who are approved
    // Wait, if activeMembers > paidMembersCount, pendingMembers will be negative.
    // If activeMembers is counted from all members (including unpaid), then
    // pendingMembers = (All Members) - (Active Members) - (Suspended/Rejected) ?
    const pendingMembers = allMembers.filter((m: any) => m.membershipStatus === 'pending').length;
    
    // If we want the numbers to add up nicely for the dashboard...
    console.log({
        totalMembersCount, // 815
        paidMembersCount,  // 441
        unpaidMembers,     // 374
        activeMembers,     // 175
        pendingMembers,    // 412
    });
}
run().catch(console.error).finally(()=>process.exit(0));
