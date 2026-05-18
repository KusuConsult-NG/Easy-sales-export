/**
 * true-stats-audit.ts
 *
 * Pulls the ground-truth counts directly from Firestore,
 * bypassing all auth/session/cache layers.
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/true-stats-audit.ts
 */

import { db } from "../src/lib/firebase-admin";

async function count(field: string, value: string) {
    const snap = await db.collection("cooperative_members")
        .where(field, "==", value).count().get();
    return snap.data().count;
}

async function main() {
    console.log("\n📊 TRUE COOPERATIVE STATS (direct Firestore read)\n");
    console.log("   Time:", new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" }), "(WAT)\n");

    // ── Membership Status breakdown ──────────────────────────
    const statusValues = ["active", "approved", "pending", "rejected", "suspended", "inactive"];
    const statusCounts: Record<string, number> = {};
    for (const s of statusValues) {
        statusCounts[s] = await count("membershipStatus", s);
    }

    // Total docs
    const totalSnap = await db.collection("cooperative_members").count().get();
    const totalDocs = totalSnap.data().count;

    // Docs with no membershipStatus field
    const knownTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const noStatus = totalDocs - knownTotal;

    console.log("── Membership Status ───────────────────────────────────");
    for (const [status, cnt] of Object.entries(statusCounts)) {
        if (cnt > 0) console.log(`   ${status.padEnd(15)}: ${cnt}`);
    }
    if (noStatus > 0) console.log(`   (no status)    : ${noStatus}`);
    console.log(`   ${"TOTAL".padEnd(15)}: ${totalDocs}`);
    console.log();

    // ── Payment Status breakdown ─────────────────────────────
    const paymentValues = ["completed", "pending", "failed", "refunded"];
    const paymentCounts: Record<string, number> = {};
    for (const p of paymentValues) {
        paymentCounts[p] = await count("paymentStatus", p);
    }
    const knownPayTotal = Object.values(paymentCounts).reduce((a, b) => a + b, 0);
    const noPayment = totalDocs - knownPayTotal;

    console.log("── Payment Status ──────────────────────────────────────");
    for (const [status, cnt] of Object.entries(paymentCounts)) {
        if (cnt > 0) console.log(`   ${status.padEnd(15)}: ${cnt}`);
    }
    if (noPayment > 0) console.log(`   (no payment)   : ${noPayment}`);
    console.log();

    // ── Approved (active+approved) & Paid ────────────────────
    const approved   = statusCounts["active"] + statusCounts["approved"];
    const paid       = paymentCounts["completed"];
    const pending    = statusCounts["pending"];

    // Cross: active AND paid
    const activeAndPaidSnap = await db.collection("cooperative_members")
        .where("membershipStatus", "in", ["active", "approved"])
        .where("paymentStatus", "==", "completed")
        .count().get();
    const activeAndPaid = activeAndPaidSnap.data().count;

    // Active but NOT paid
    const activeUnpaid = approved - activeAndPaid;

    // Pending but paid
    const pendingAndPaidSnap = await db.collection("cooperative_members")
        .where("membershipStatus", "==", "pending")
        .where("paymentStatus", "==", "completed")
        .count().get();
    const pendingAndPaid = pendingAndPaidSnap.data().count;

    console.log("── Cross-Dimension Summary ─────────────────────────────");
    console.log(`   Total applications       : ${totalDocs}`);
    console.log(`   Approved (active+approved): ${approved}`);
    console.log(`   Pending approval          : ${pending}`);
    console.log(`   Paid (any status)         : ${paid}`);
    console.log(`   Approved AND paid         : ${activeAndPaid}`);
    console.log(`   Approved but UNPAID       : ${activeUnpaid}`);
    console.log(`   Pending but already paid  : ${pendingAndPaid}`);
    console.log();

    // ── What the dashboard was showing vs reality ────────────
    console.log("── Dashboard Claimed vs Reality ────────────────────────");
    console.log(`   Stat                  | Dashboard showed | Actual`);
    console.log(`   ──────────────────────────────────────────────────────`);
    console.log(`   Pending               |      397         | ${pending}`);
    console.log(`   Approved              |       44         | ${approved}`);
    console.log(`   Total Paid Members    |      441         | ${paid}`);
    console.log(`   Total Applications    |      815         | ${totalDocs}`);
    console.log(`   Unpaid Members        |      374         | ${totalDocs - paid}`);
    console.log();

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
