/**
 * REPAIR SCRIPT: Fix cooperative members whose payments succeeded on Paystack
 * but were never confirmed in Firestore due to the metadata bug.
 *
 * ROOT CAUSE: Paystack metadata used `purpose` instead of `type`, so the
 * webhook never processed cooperative_membership_registration payments.
 *
 * This script:
 * 1. Loads all cooperative_members with paymentStatus = "pending"
 * 2. For each one that has a paymentReference, verifies with Paystack API
 * 3. If Paystack confirms success, updates paymentStatus to "completed"
 *
 * USAGE:
 *   npx tsx scripts/repair-cooperative-members.ts [--dry-run]
 *
 * --dry-run: Preview changes without writing to Firestore.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const db = getAdminDb();
const DRY_RUN = process.argv.includes("--dry-run");
const PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY;

async function verifyWithPaystack(reference: string): Promise<{ success: boolean; amount: number; status: string }> {
    if (!PAYSTACK_KEY) return { success: false, amount: 0, status: "no_api_key" };

    try {
        const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_KEY}` },
        });
        const data = await res.json();

        if (data.status && data.data?.status === "success") {
            return { success: true, amount: data.data.amount / 100, status: "success" };
        }
        return { success: false, amount: (data.data?.amount || 0) / 100, status: data.data?.status || "unknown" };
    } catch (err: any) {
        return { success: false, amount: 0, status: `error: ${err.message}` };
    }
}

// Rate limiter: Paystack allows ~10 req/s, be conservative
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    console.log("=".repeat(60));
    console.log("COOPERATIVE MEMBERS REPAIR SCRIPT");
    console.log(DRY_RUN ? "🔍 DRY RUN MODE — no writes will be made" : "🔧 LIVE MODE — will update Firestore");
    console.log(`Project: ${process.env.FIREBASE_PROJECT_ID}`);
    console.log(`Paystack key: ${PAYSTACK_KEY ? "✅ loaded" : "❌ MISSING"}`);
    console.log("=".repeat(60));

    if (!PAYSTACK_KEY) {
        console.error("\n❌ PAYSTACK_SECRET_KEY not set in .env.local. Cannot verify payments.");
        process.exit(1);
    }

    // Load all pending members
    const pendingSnap = await db.collection("cooperative_members")
        .where("paymentStatus", "==", "pending")
        .get();

    console.log(`\n📋 Found ${pendingSnap.size} members with paymentStatus="pending"\n`);

    let verified = 0;
    let alreadyPending = 0;
    let noRef = 0;
    let failed = 0;
    let abandoned = 0;

    const verifiedMembers: Array<{ id: string; amount: number; reference: string }> = [];

    for (let i = 0; i < pendingSnap.docs.length; i++) {
        const doc = pendingSnap.docs[i];
        const data = doc.data();
        const reference = data.paymentReference;
        const userId = data.userId || doc.id;

        if (!reference) {
            noRef++;
            continue;
        }

        // Rate limit: 5 requests per second
        if (i > 0 && i % 5 === 0) {
            await sleep(1100);
        }

        const result = await verifyWithPaystack(reference);

        if (result.success) {
            verified++;
            const tier = result.amount >= 20000 ? "premium" : "basic";
            console.log(`  ✅ ${String(verified).padStart(3)}. ${userId} | ref=${reference} | ₦${result.amount} → ${tier}`);
            verifiedMembers.push({ id: doc.id, amount: result.amount, reference });
        } else if (result.status === "abandoned") {
            abandoned++;
        } else if (result.status === "pending" || result.status === "ongoing") {
            alreadyPending++;
        } else {
            failed++;
            if (failed <= 10) {
                console.log(`  ❌ ${userId} | ref=${reference} | status: ${result.status}`);
            }
        }
    }

    console.log(`\n${"─".repeat(60)}`);
    console.log(`VERIFICATION RESULTS:`);
    console.log(`  ✅ Verified (paid):     ${verified}`);
    console.log(`  ⏳ Still pending:       ${alreadyPending}`);
    console.log(`  🚪 Abandoned:           ${abandoned}`);
    console.log(`  ❌ Failed/other:        ${failed}`);
    console.log(`  📎 No reference:        ${noRef}`);
    console.log(`${"─".repeat(60)}`);

    if (verified === 0) {
        console.log("\n✅ No members need repair. All pending members have unverified payments.");
        return;
    }

    // Apply fixes
    console.log(`\n${DRY_RUN ? "🔍 Would repair" : "🔧 Repairing"} ${verified} members...\n`);

    if (!DRY_RUN) {
        // Process in batches of 500 (Firestore batch limit)
        const BATCH_SIZE = 400;
        for (let i = 0; i < verifiedMembers.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = verifiedMembers.slice(i, i + BATCH_SIZE);

            for (const member of chunk) {
                const memberRef = db.collection("cooperative_members").doc(member.id);
                const tier = member.amount >= 20000 ? "premium" : "basic";

                batch.update(memberRef, {
                    paymentStatus: "completed",
                    membershipTier: tier,
                    registrationFee: member.amount,
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _repairedAt: FieldValue.serverTimestamp(),
                    _repairReason: "Webhook metadata used 'purpose' instead of 'type' — verified via Paystack API",
                });

                // Also create processedPayments entry to prevent future duplicates
                const processedRef = db.collection("processedPayments").doc(member.reference);
                batch.set(processedRef, {
                    reference: member.reference,
                    type: "cooperative_membership_registration",
                    userId: member.id,
                    amount: member.amount,
                    processedAt: FieldValue.serverTimestamp(),
                    source: "repair_script",
                });
            }

            await batch.commit();
            console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: committed ${chunk.length} repairs`);
        }
    }

    console.log("\n" + "=".repeat(60));
    console.log(`TOTAL REPAIRED: ${verified}`);
    if (DRY_RUN) {
        console.log("⚠️  This was a DRY RUN. Re-run without --dry-run to apply fixes.");
    } else {
        console.log("✅ All repairs applied to Firestore.");
        console.log("   Members should now be visible in the admin portal.");
    }
    console.log("=".repeat(60));
}

main().catch(err => {
    console.error("Script failed:", err);
    process.exit(1);
});
