/**
 * sync-cooperative-members.js
 *
 * Syncs cooperative_members.paymentStatus = "completed" for all users
 * who have a matching processedPayments doc with type = "cooperative_membership_registration".
 *
 * Also creates cooperative_transactions docs for each membership payment so the
 * admin cooperatives/transactions page shows real data.
 *
 * Usage: node scripts/sync-cooperative-members.js
 */

const path = require("path");
const fs = require("fs");

// Read .env.local directly (same pattern as other backfill scripts)
function readDotEnvLocal() {
    const envPath = path.join(__dirname, "..", ".env.local");
    const content = fs.readFileSync(envPath, "utf8");
    const vars = {};
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        let value = trimmed.substring(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        value = value.replace(/\\n/g, "\n");
        vars[key] = value;
    }
    return vars;
}

const envVars = readDotEnvLocal();

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const projectId = envVars.FIREBASE_PROJECT_ID;
const clientEmail = envVars.FIREBASE_CLIENT_EMAIL;
const privateKey = envVars.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
    console.error("❌ Missing Firebase credentials in .env.local");
    process.exit(1);
}

if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}
const db = getFirestore();

async function main() {
    console.log("🔄 Syncing cooperative members from processedPayments...\n");

    // 1. Fetch all cooperative membership payments
    const paymentsSnap = await db
        .collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .get();

    console.log(`Found ${paymentsSnap.size} cooperative membership payments in processedPayments.\n`);

    let updatedMembers = 0;
    let createdTransactions = 0;
    let skippedAlreadyUpdated = 0;
    let errors = 0;

    for (const paymentDoc of paymentsSnap.docs) {
        const payment = paymentDoc.data();
        const { userId, amount, processedAt, paystackMetadata, status } = payment;
        const tier = paystackMetadata?.membershipTier || payment.tier || "basic";
        const reference = paymentDoc.id;

        if (!userId) {
            console.log(`⚠️  Payment ${reference} has no userId — skipping`);
            continue;
        }

        try {
            // 2. Update or create cooperative_members.paymentStatus
            const memberRef = db.collection("cooperative_members").doc(userId);
            const memberDoc = await memberRef.get();

            if (memberDoc.exists) {
                const memberData = memberDoc.data();
                if (memberData.paymentStatus === "completed") {
                    skippedAlreadyUpdated++;
                } else {
                    await memberRef.set(
                        {
                            paymentStatus: "completed",
                            membershipTier: tier,
                            paymentReference: reference,
                            updatedAt: FieldValue.serverTimestamp(),
                        },
                        { merge: true }
                    );
                    console.log(`✅ [member] Updated ${userId} → paymentStatus: completed`);
                    updatedMembers++;
                }
            } else {
                // Create a base member record (admin can complete onboarding separately)
                await memberRef.set({
                    userId,
                    membershipTier: tier,
                    registrationFee: amount || 10000,
                    membershipStatus: "pending",
                    paymentStatus: "completed",
                    paymentReference: reference,
                    createdAt: processedAt || FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
                console.log(`✅ [member] Created cooperative_members/${userId}`);
                updatedMembers++;
            }

            // 3. Create a cooperative_transaction for this membership fee (if not already there)
            const txnRef = db.collection("cooperative_transactions").doc(reference);
            const txnDoc = await txnRef.get();
            if (!txnDoc.exists) {
                await txnRef.set({
                    userId,
                    type: "membership_registration",
                    amount: amount || 10000,
                    status: "completed",
                    date: processedAt || FieldValue.serverTimestamp(),
                    description: `${tier === "premium" ? "Premium" : "Basic"} Membership Registration Fee`,
                    reference,
                    membershipTier: tier,
                    source: "processedPayments_sync",
                });
                console.log(`  ↳ [txn] Created cooperative_transactions/${reference}`);
                createdTransactions++;
            }
        } catch (err) {
            console.error(`❌ Error processing payment ${reference}:`, err.message);
            errors++;
        }
    }

    console.log("\n=== Summary ===");
    console.log(`✅ Members updated to paymentStatus=completed: ${updatedMembers}`);
    console.log(`⏭️  Already completed (skipped): ${skippedAlreadyUpdated}`);
    console.log(`✅ cooperative_transactions created: ${createdTransactions}`);
    console.log(`❌ Errors: ${errors}`);
    process.exit(0);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
