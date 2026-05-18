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

    console.log("Total members:", allMembers.length);
    console.log("Total unique users in processedPayments:", paidUserIds.size);

    const activeOrApproved = allMembers.filter((m: any) =>
        m.membershipStatus === 'active' || m.membershipStatus === 'approved' ||
        m.status === 'active' || m.status === 'approved'
    );
    console.log('Total active/approved:', activeOrApproved.length);

    let actualPaidCount = 0;
    allMembers.forEach(m => {
        const isPaid = paidUserIds.has(m.userId) || paidUserIds.has(m.id);
        const isActive = m.membershipStatus === 'active' || m.membershipStatus === 'approved' ||
            m.status === 'active' || m.status === 'approved';
        
        if (isPaid || isActive) actualPaidCount++;
    });
    console.log('Total paid (in processedPayments OR manually approved):', actualPaidCount);
}
run().catch(console.error).finally(()=>process.exit(0));
