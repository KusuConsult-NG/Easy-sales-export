import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Finding Unmatched Academy Payments...");

    // 1. Fetch completed academy payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    const acadPayments: any[] = [];
    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        
        const isAcad = type === "academy_registration" || 
                       type === "academy" || 
                       String(data.purpose).includes("academy") ||
                       String(data.metadata?.purpose).includes("academy") ||
                       String(data.paystackMetadata?.purpose).includes("academy");

        if (isAcad) {
            acadPayments.push({
                docId: doc.id,
                reference: data.reference || doc.id,
                userId: data.userId || data.metadata?.userId || data.paystackMetadata?.userId,
                email: data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email,
                amount: data.amount,
                type
            });
        }
    });

    // 2. Fetch approved applications
    const appsSnap = await db.collection("academy_applications")
        .where("status", "==", "approved")
        .get();

    const approvedUserIds = new Set<string>();
    const approvedEmails = new Set<string>();
    const approvedRefs = new Set<string>();

    appsSnap.docs.forEach(doc => {
        const app = doc.data();
        if (app.userId) approvedUserIds.add(app.userId);
        const email = (app.personalInfo?.email || app.email || "").toLowerCase().trim();
        if (email) approvedEmails.add(email);
        if (app.paymentReference) approvedRefs.add(app.paymentReference);
    });

    const unmatchedPayments: any[] = [];

    for (const payment of acadPayments) {
        const hasUserIdMatch = payment.userId && approvedUserIds.has(payment.userId);
        const hasEmailMatch = payment.email && approvedEmails.has(payment.email.toLowerCase().trim());
        const hasRefMatch = payment.reference && approvedRefs.has(payment.reference);

        if (!hasUserIdMatch && !hasEmailMatch && !hasRefMatch) {
            unmatchedPayments.push(payment);
        }
    }

    console.log(`Found ${unmatchedPayments.length} unmatched academy payments (out of ${acadPayments.length} total).`);
    console.log("\nAll unmatched academy payments:");
    console.log(JSON.stringify(unmatchedPayments, null, 2));

    // For these unmatched payments, let's see if their users exist in the users collection
    console.log("\nChecking if users for these payments exist in 'users' collection...");
    for (const payment of unmatchedPayments) {
        if (payment.userId) {
            const userDoc = await db.collection("users").doc(payment.userId).get();
            console.log(`- User ${payment.userId}: ${userDoc.exists ? 'EXISTS' : 'DOES NOT EXIST'} | email: ${userDoc.exists ? userDoc.data()?.email : 'N/A'}`);
        }
    }
}

main();
