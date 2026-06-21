import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Verifying the 20 Paid Academy Members...");

    // 1. Fetch completed academy payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    const paymentMap = new Map<string, any>();
    const paymentByUserId = new Map<string, any>();
    const paymentByEmail = new Map<string, any>();

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        
        const isAcad = type === "academy_registration" || 
                       type === "academy" || 
                       String(data.purpose).includes("academy") ||
                       String(data.metadata?.purpose).includes("academy") ||
                       String(data.paystackMetadata?.purpose).includes("academy");

        if (isAcad) {
            const ref = data.reference || doc.id;
            const userId = data.userId || data.metadata?.userId || data.paystackMetadata?.userId;
            const email = data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email;

            const paymentInfo = {
                reference: ref,
                userId,
                email,
                amount: data.amount,
                processedAt: data.processedAt?.toDate ? data.processedAt.toDate() : (data.processedAt || "N/A"),
                type
            };

            paymentMap.set(ref, paymentInfo);
            if (userId) paymentByUserId.set(userId, paymentInfo);
            if (email) paymentByEmail.set(email.toLowerCase().trim(), paymentInfo);
        }
    });

    // 2. Fetch approved applications
    const appsSnap = await db.collection("academy_applications")
        .where("status", "==", "approved")
        .get();

    console.log(`Total approved academy applications: ${appsSnap.size}`);

    const verifiedPaidList: any[] = [];

    appsSnap.docs.forEach(doc => {
        const app = doc.data();
        const userId = app.userId;
        const email = (app.personalInfo?.email || app.email || "").toLowerCase().trim();
        const ref = app.paymentReference;

        const payInfoByRef = ref ? paymentMap.get(ref) : null;
        const payInfoByUserId = userId ? paymentByUserId.get(userId) : null;
        const payInfoByEmail = email ? paymentByEmail.get(email) : null;
        const matchedPayment = payInfoByRef || payInfoByUserId || payInfoByEmail;

        if (matchedPayment) {
            verifiedPaidList.push({
                docId: doc.id,
                userId,
                email,
                name: app.personalInfo?.fullName || "Unknown",
                applicationPlan: app.plan || null,
                paymentReference: matchedPayment.reference,
                paymentAmount: matchedPayment.amount,
                paymentType: matchedPayment.type,
                processedAt: matchedPayment.processedAt
            });
        }
    });

    console.log(`\nFound ${verifiedPaidList.length} verified paid approved members.`);
    console.log("\nDetails of the verified paid members:");
    console.log(JSON.stringify(verifiedPaidList, null, 2));
}

main();
