import { db } from "../src/lib/firebase-admin";

async function checkAcademyOnly10k() {
    const academyApps = await db.collection("academy_applications").get();
    const academyUserIds = new Set<string>();
    academyApps.docs.forEach(doc => academyUserIds.add(doc.data().userId));
    
    const payments = await db.collection("processedPayments").where("status", "==", "completed").get();
    
    const userToPayments: Record<string, number[]> = {};
    payments.docs.forEach(doc => {
        const p = doc.data();
        if (p.userId) {
            if (!userToPayments[p.userId]) userToPayments[p.userId] = [];
            userToPayments[p.userId].push(p.amount);
        }
    });

    let academyUsersWithOnly10k = 0;
    
    for (const userId of academyUserIds) {
        const amounts = userToPayments[userId] || [];
        const has10k = amounts.includes(10000);
        const hasAcademyAmount = amounts.includes(25000) || amounts.includes(50000) || amounts.includes(100000) || amounts.includes(2500000) || amounts.includes(5000000) || amounts.includes(10000000);
        
        if (has10k && !hasAcademyAmount) {
            academyUsersWithOnly10k++;
            console.log(`User ${userId} has 10k payment but NO academy amount! App status: ${academyApps.docs.find(d => d.data().userId === userId)?.data().status}`);
        }
    }
    
    console.log(`Total Academy applicants with ONLY 10k payment: ${academyUsersWithOnly10k}`);
}

checkAcademyOnly10k().catch(console.error);
