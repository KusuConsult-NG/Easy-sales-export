import { db } from "../src/lib/firebase-admin";
import * as fs from "fs";

async function healPaystackParity() {
    const data = JSON.parse(fs.readFileSync("missing_paystack_transactions.json", "utf8"));
    console.log(`Processing ${data.length} missing transactions...`);

    let healed = 0;
    let notFound = 0;

    for (const tx of data) {
        if (!tx.email) {
            console.log(`Skipping ${tx.reference} - no email`);
            continue;
        }

        const userSnap = await db.collection("users").where("email", "==", tx.email).limit(1).get();
        let userId = null;
        let userData = null;

        if (!userSnap.empty) {
            userId = userSnap.docs[0].id;
            userData = userSnap.docs[0].data();
        } else {
            console.log(`User not found for email ${tx.email} (ref: ${tx.reference})`);
            notFound++;
        }

        // 1. Create processedPayments record
        const paymentData: any = {
            userId: userId || "UNMATCHED",
            reference: tx.reference,
            amount: tx.amount,
            type: "cooperative_membership_registration",
            status: "completed",
            channel: tx.channel || "paystack",
            createdAt: new Date(tx.date),
            metadata: {
                healedByScript: true,
                email: tx.email
            }
        };

        const existingPaymentSnap = await db.collection("processedPayments").where("reference", "==", tx.reference).get();
        if (existingPaymentSnap.empty) {
            await db.collection("processedPayments").add(paymentData);
            console.log(`Created processedPayment for ${tx.reference}`);
        } else {
            console.log(`Payment ${tx.reference} already exists in DB somehow.`);
        }

        // 2. If user exists, update their cooperative membership
        if (userId) {
            const coopSnap = await db.collection("cooperative_members").where("userId", "==", userId).get();
            if (coopSnap.empty) {
                await db.collection("cooperative_members").add({
                    userId,
                    firstName: userData?.firstName || "",
                    lastName: userData?.lastName || "",
                    email: tx.email,
                    paymentStatus: "completed",
                    membershipStatus: "active",
                    amountPaid: tx.amount,
                    paymentReference: tx.reference,
                    createdAt: new Date(tx.date),
                    updatedAt: new Date(),
                    healedByScript: true
                });
                console.log(`Created cooperative_members record for ${userId}`);
            } else {
                const coopId = coopSnap.docs[0].id;
                await db.collection("cooperative_members").doc(coopId).update({
                    paymentStatus: "completed",
                    membershipStatus: "active",
                    amountPaid: tx.amount,
                    paymentReference: tx.reference,
                    updatedAt: new Date()
                });
                console.log(`Updated cooperative_members record for ${userId}`);
            }

            // 3. Update user profile
            await db.collection("users").doc(userId).set({
                serviceRegistrations: {
                    cooperative: {
                        paymentStatus: "completed",
                        status: "active",
                        updatedAt: new Date()
                    }
                }
            }, { merge: true });
        }

        healed++;
    }

    console.log(`\nFinished! Healed: ${healed}, User not found for: ${notFound}`);
}

healPaystackParity().catch(console.error);
