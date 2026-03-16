/**
 * DIAGNOSTIC: Show the actual state of cooperative_members and processedPayments
 * Uses the project's own firebase-admin init to ensure correct project connection.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";

const db = getAdminDb();

async function main() {
    console.log(`Connected to project: ${process.env.FIREBASE_PROJECT_ID}\n`);

    console.log("=== ALL cooperative_members documents ===\n");
    const membersSnap = await db.collection("cooperative_members").get();
    console.log(`Total documents: ${membersSnap.size}\n`);

    for (const doc of membersSnap.docs) {
        const d = doc.data();
        console.log(`  ID: ${doc.id}`);
        console.log(`    userId: ${d.userId}`);
        console.log(`    name: ${d.firstName || ""} ${d.lastName || ""}`);
        console.log(`    email: ${d.email || "—"}`);
        console.log(`    membershipTier: ${d.membershipTier}`);
        console.log(`    registrationFee: ${d.registrationFee}`);
        console.log(`    paymentStatus: ${d.paymentStatus}`);
        console.log(`    membershipStatus: ${d.membershipStatus}`);
        console.log(`    paymentReference: ${d.paymentReference || "NONE"}`);
        console.log(`    onboardingCompleted: ${d.onboardingCompleted}`);
        console.log(`    createdAt: ${d.createdAt?.toDate?.() || d.createdAt}`);
        console.log("");
    }

    console.log("\n=== processedPayments (first 30) ===\n");
    const processedSnap = await db.collection("processedPayments").limit(30).get();
    console.log(`Total (up to 30): ${processedSnap.size}\n`);
    for (const doc of processedSnap.docs) {
        const d = doc.data();
        console.log(`  Ref: ${doc.id} | type: ${d.type} | amount: ₦${d.amount} | userId: ${d.userId} | status: ${d.status || "—"}`);
    }

    console.log("\n=== processedPayments with ₦10k/₦20k ===\n");
    let count = 0;
    for (const doc of processedSnap.docs) {
        const d = doc.data();
        if (d.amount === 10000 || d.amount === 20000) {
            count++;
            console.log(`  Ref: ${doc.id} | type: ${d.type} | amount: ₦${d.amount} | userId: ${d.userId} | status: ${d.status || "—"}`);
        }
    }
    if (count === 0) console.log("  None found.");

    console.log(`\n=== SUMMARY ===`);
    console.log(`cooperative_members: ${membersSnap.size} total`);
    console.log(`  completed: ${membersSnap.docs.filter(d => d.data().paymentStatus === "completed").length}`);
    console.log(`  pending:   ${membersSnap.docs.filter(d => d.data().paymentStatus === "pending").length}`);
    console.log(`  other:     ${membersSnap.docs.filter(d => !["completed","pending"].includes(d.data().paymentStatus)).length}`);
}

main().catch(err => { console.error("Script failed:", err); process.exit(1); });
