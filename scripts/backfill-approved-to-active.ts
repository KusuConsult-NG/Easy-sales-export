/**
 * backfill-approved-to-active.ts
 *
 * The approve-member API route previously wrote membershipStatus: "approved"
 * instead of "active". This left 166 members invisible in some admin views
 * that only checked for "active".
 *
 * This script migrates all "approved" cooperative_members docs → "active",
 * and also ensures the corresponding users/ doc has the cooperative_member
 * role and serviceRegistrations.cooperatives.status = "active".
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-approved-to-active.ts
 */

import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`\n${DRY_RUN ? "🔍 DRY RUN — " : ""}Backfill: approved → active\n`);

  const snap = await db
    .collection("cooperative_members")
    .where("membershipStatus", "==", "approved")
    .get();

  console.log(`Found ${snap.size} members with membershipStatus = "approved"\n`);

  if (snap.size === 0) {
    console.log("Nothing to migrate. ✅");
    return;
  }

  let ok = 0, failed = 0, skippedUserDoc = 0;
  const docs = snap.docs;

  for (const doc of docs) {
    const data = doc.data();
    const userId = data.userId || doc.id;

    if (DRY_RUN) {
      console.log(`  [DRY] ${doc.id} → active (userId: ${userId})`);
      ok++;
      continue;
    }

    try {
      // Check if user doc exists first to avoid batch failures
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();

      // Always update the member doc
      await doc.ref.update({
        membershipStatus: "active",
        updatedAt: FieldValue.serverTimestamp(),
        _version: FieldValue.increment(1),
        _backfilledAt: FieldValue.serverTimestamp(),
      });

      // Only update the user doc if it actually exists
      if (userDoc.exists) {
        await userRef.update({
          isVerified: true,
          roles: FieldValue.arrayUnion("cooperative_member"),
          "serviceRegistrations.cooperatives.status": "active",
          "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          _version: FieldValue.increment(1),
        });
      } else {
        skippedUserDoc++;
        console.log(`  ⚠️  No users/ doc for memberId=${doc.id} userId=${userId} — member doc updated, user doc skipped`);
      }

      ok++;
      process.stdout.write(`\r  ✅ ${ok}/${docs.length} migrated`);
    } catch (e: any) {
      failed++;
      console.error(`\n  ❌ FAILED for ${doc.id}:`, e.message);
    }
  }
  console.log(); // newline after progress

  console.log(`\n── Summary ─────────────────────────────────`);
  console.log(`  Total "approved" docs found : ${snap.size}`);
  console.log(`  ${DRY_RUN ? "Would migrate" : "Migrated"}             : ${ok}`);
  if (failed > 0) console.log(`  Failed                     : ${failed}`);
  console.log(`\n${DRY_RUN ? "Run without --dry-run to apply." : "✅ Done. Admin dashboard will now show all approved members."}\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
