/**
 * audit-cooperative-members.ts
 * Audits what's in the cooperative_members collection to explain the 43 vs 100+ discrepancy.
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/audit-cooperative-members.ts
 */

import { db } from "../src/lib/firebase-admin";

async function main() {
  console.log("\nCooperative Members — Full Audit\n");

  const snap = await db.collection("cooperative_members")
    .orderBy("createdAt", "desc")
    .limit(5000)
    .get();

  console.log(`Total documents in cooperative_members: ${snap.size}\n`);

  // Count by membershipStatus
  const byMembershipStatus: Record<string, number> = {};
  const byPaymentStatus: Record<string, number> = {};
  const byRegistrationStatus: Record<string, number> = {};
  const byStatus: Record<string, number> = {}; // generic 'status' field

  // Track the filter logic from the bug
  let passesCurrentFilter = 0;
  let failsCurrentFilter = 0;
  let failsCurrentFilterSamples: any[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();

    // membershipStatus
    const ms = d.membershipStatus ?? "(not set)";
    byMembershipStatus[ms] = (byMembershipStatus[ms] || 0) + 1;

    // paymentStatus
    const ps = d.paymentStatus ?? "(not set)";
    byPaymentStatus[ps] = (byPaymentStatus[ps] || 0) + 1;

    // registrationStatus
    const rs = d.registrationStatus ?? "(not set)";
    byRegistrationStatus[rs] = (byRegistrationStatus[rs] || 0) + 1;

    // generic status
    const st = d.status ?? "(not set)";
    byStatus[st] = (byStatus[st] || 0) + 1;

    // Does this doc pass the current filter in _getAllMembersAction (lines 295-299)?
    const passesFilter =
      d.membershipStatus === "active" ||
      d.paymentStatus === "completed" ||
      d.registrationStatus === "completed";

    if (passesFilter) {
      passesCurrentFilter++;
    } else {
      failsCurrentFilter++;
      // Collect samples of hidden members
      if (failsCurrentFilterSamples.length < 5) {
        failsCurrentFilterSamples.push({
          id: doc.id,
          membershipStatus: d.membershipStatus,
          paymentStatus: d.paymentStatus,
          registrationStatus: d.registrationStatus,
          status: d.status,
          createdAt: d.createdAt?.toDate?.()?.toISOString() ?? d.createdAt,
        });
      }
    }
  }

  console.log("── membershipStatus breakdown ──────────────────────────");
  Object.entries(byMembershipStatus)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(k).padEnd(25)} ${v}`));

  console.log("\n── paymentStatus breakdown ─────────────────────────────");
  Object.entries(byPaymentStatus)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(k).padEnd(25)} ${v}`));

  console.log("\n── registrationStatus breakdown ────────────────────────");
  Object.entries(byRegistrationStatus)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(k).padEnd(25)} ${v}`));

  console.log("\n── generic status breakdown ────────────────────────────");
  Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(k).padEnd(25)} ${v}`));

  console.log("\n── Filter simulation (current bug) ─────────────────────");
  console.log(`  VISIBLE (pass filter)  : ${passesCurrentFilter}`);
  console.log(`  HIDDEN  (fail filter)  : ${failsCurrentFilter}`);

  if (failsCurrentFilterSamples.length > 0) {
    console.log("\n── Sample hidden members (first 5) ─────────────────────");
    failsCurrentFilterSamples.forEach((s, i) => {
      console.log(`  [${i + 1}] id: ${s.id}`);
      console.log(`       membershipStatus  : ${s.membershipStatus}`);
      console.log(`       paymentStatus     : ${s.paymentStatus}`);
      console.log(`       registrationStatus: ${s.registrationStatus}`);
      console.log(`       status            : ${s.status}`);
      console.log(`       createdAt         : ${s.createdAt}`);
    });
  }

  console.log("\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
