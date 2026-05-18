/**
 * audit-payments-truth.ts
 *
 * Counts paid members using PROCESSED_PAYMENTS as the source of truth,
 * then cross-references with cooperative_members docs.
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/audit-payments-truth.ts
 */

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("\n📊 PAYMENT SOURCE OF TRUTH AUDIT\n");
    console.log("   Time:", new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" }), "(WAT)\n");

    // 1. All cooperative_members docs
    const membersSnap = await db.collection("cooperative_members").limit(5000).get();
    const allMembers = membersSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
    console.log(`cooperative_members total docs   : ${allMembers.length}`);

    // 2. paymentStatus field on member docs
    const paidByField = allMembers.filter(m => m.paymentStatus === "completed").length;
    const pendingByField = allMembers.filter(m => m.paymentStatus === "pending").length;
    const noPayField = allMembers.filter(m => !m.paymentStatus).length;
    console.log(`  paymentStatus=completed (field) : ${paidByField}`);
    console.log(`  paymentStatus=pending   (field) : ${pendingByField}`);
    console.log(`  paymentStatus=(missing) (field) : ${noPayField}`);
    console.log();

    // 3. PROCESSED_PAYMENTS — show all type values to understand what's there
    console.log("── PROCESSED_PAYMENTS collection ───────────────────────");
    const allPaymentsSnap = await db.collection("processed_payments").limit(5000).get();
    console.log(`Total docs in processed_payments : ${allPaymentsSnap.docs.length}`);

    // Group by type
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const doc of allPaymentsSnap.docs) {
        const d = doc.data();
        const t = d.type || "(no type)";
        const s = d.status || "(no status)";
        byType[t] = (byType[t] || 0) + 1;
        byStatus[s] = (byStatus[s] || 0) + 1;
    }
    console.log("\n  By type:");
    for (const [t, c] of Object.entries(byType).sort((a,b) => b[1]-a[1])) {
        console.log(`    ${t.padEnd(45)}: ${c}`);
    }
    console.log("\n  By status:");
    for (const [s, c] of Object.entries(byStatus)) {
        console.log(`    ${s.padEnd(45)}: ${c}`);
    }
    console.log();

    // 4. Count unique userId values in COMPLETED payments (all types)
    const completedPayments = allPaymentsSnap.docs.filter(d => d.data().status === "completed");
    const uniquePaidUserIds = new Set(completedPayments.map(d => d.data().userId).filter(Boolean));
    console.log(`Unique userIds with completed payment (any type): ${uniquePaidUserIds.size}`);

    // 5. Cross-reference: which of those userIds exist in cooperative_members
    const memberUserIds = new Set(allMembers.map(m => m.userId || m.id).filter(Boolean));
    const paidAndIsMember = [...uniquePaidUserIds].filter(uid => memberUserIds.has(uid));
    const paidNotMember   = [...uniquePaidUserIds].filter(uid => !memberUserIds.has(uid));
    console.log(`  Of those — also in cooperative_members : ${paidAndIsMember.length}`);
    console.log(`  Of those — NOT in cooperative_members  : ${paidNotMember.length}`);
    console.log();

    // 6. Cooperative-specific payment types
    const coopTypes = Object.keys(byType).filter(t =>
        t.toLowerCase().includes("cooperative") || t.toLowerCase().includes("membership") || t.toLowerCase().includes("registration")
    );
    console.log(`── Cooperative-specific payment types found: [${coopTypes.join(", ")}]`);
    for (const coopType of coopTypes) {
        const coopSnap = allPaymentsSnap.docs.filter(d => d.data().type === coopType && d.data().status === "completed");
        const uniqueCoopPaid = new Set(coopSnap.map(d => d.data().userId).filter(Boolean));
        console.log(`  type="${coopType}" → ${coopSnap.length} completed payments, ${uniqueCoopPaid.size} unique users`);
    }

    // 7. Members with paymentStatus != completed but who have a completed payment record
    const paidByRecord = new Set(
        allPaymentsSnap.docs
            .filter(d => d.data().status === "completed")
            .map(d => d.data().userId)
            .filter(Boolean)
    );
    const memberPaidByRecord  = allMembers.filter(m => paidByRecord.has(m.userId || m.id));
    const memberFieldMismatch = memberPaidByRecord.filter(m => m.paymentStatus !== "completed");

    console.log(`\n── Field vs Record Mismatch ────────────────────────────`);
    console.log(`  Members with completed payment RECORD    : ${memberPaidByRecord.length}`);
    console.log(`  Members where paymentStatus field is WRONG: ${memberFieldMismatch.length}`);
    if (memberFieldMismatch.length > 0) {
        console.log(`  (field shows: ${[...new Set(memberFieldMismatch.map(m => m.paymentStatus || "(missing)"))].join(", ")})`);
    }

    console.log(`\n── FINAL GROUND TRUTH ──────────────────────────────────`);
    console.log(`  Total cooperative_members             : ${allMembers.length}`);
    console.log(`  Paid (by payment RECORD)              : ${memberPaidByRecord.length}`);
    console.log(`  Paid (by paymentStatus field on doc)  : ${paidByField}`);
    console.log(`  Discrepancy                           : ${memberPaidByRecord.length - paidByField}`);
    console.log();

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
