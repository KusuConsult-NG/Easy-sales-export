
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { redis, CacheKeys } from "../src/lib/redis";

async function populateProfileAndData(email: string) {
    const db = getAdminDb();
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).where("email", "==", email).get();

    if (usersSnapshot.empty) {
        console.log(`User with email ${email} not found.`);
        return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;

    console.log(`Populating data for user: ${userId} (${email})...`);

    // 1. Update Member Profile
    await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).set({
        id: userId,
        userId,
        email,
        firstName: "Test",
        lastName: "Cooperatives User",
        phone: "+2348000000001",
        stateOfOrigin: "Lagos",
        lga: "Ikeja",
        residentialAddress: "45 Cooperative Estate, Ikeja, Lagos",
        occupation: "Business Consultant",
        membershipTier: "Member",
        membershipStatus: "active",
        paymentStatus: "completed",
        onboardingCompleted: true,
        savingsBalance: 450000,
        loanBalance: 120000,
        joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date()
    }, { merge: true });

    // 2. Add Mock Transactions
    const transactions = [
        {
            userId,
            type: "contribution",
            amount: 50000,
            date: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
            status: "completed",
            description: "Monthly Savings Contribution"
        },
        {
            userId,
            type: "interest",
            amount: 2500,
            date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
            status: "completed",
            description: "Monthly Interest Accrual"
        },
        {
            userId,
            type: "loan",
            amount: -150000,
            date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
            status: "completed",
            description: "SME Loan Disbursement"
        },
        {
            userId,
            type: "loan_payment",
            amount: 30000,
            date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            status: "completed",
            description: "Loan Installment Payment"
        }
    ];

    const batch = db.batch();
    transactions.forEach((tx) => {
        const txRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();
        batch.set(txRef, { ...tx, createdAt: new Date() });
    });
    await batch.commit();

    // 3. Clear Cache
    await redis.del(CacheKeys.userProfile(userId));

    console.log(`Successfully populated dashboard data for ${email}.`);
}

populateProfileAndData("cooperativeuser02@gmail.com")
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
