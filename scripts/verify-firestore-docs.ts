/**
 * verify-firestore-docs.ts
 * Checks what the Firestore /users/{uid} document actually contains for each module admin.
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/verify-firestore-docs.ts
 */

import { adminAuth, db } from "../src/lib/firebase-admin";

const EMAILS = [
  "easysaleswave@gmail.com",
  "easysalescooperative@gmail.com",
  "easysalesmarketplace@gmail.com",
  "easysalesexportwindow@gmail.com",
  "easysalesfarmnation@gmail.com",
  "academy.easysalesexport1@gmail.com",
];

async function main() {
  console.log("\nFirestore /users document audit\n");

  for (const email of EMAILS) {
    process.stdout.write(`${email}\n`);

    // Get UID from Firebase Auth
    let uid: string;
    try {
      const user = await adminAuth.getUserByEmail(email);
      uid = user.uid;
      console.log(`  Auth UID    : ${uid}`);
      console.log(`  Auth disabled: ${user.disabled}`);
      const claims = user.customClaims || {};
      console.log(`  Claims      : ${JSON.stringify(claims)}`);
    } catch (e: any) {
      console.log(`  ❌ Auth lookup failed: ${e.message}\n`);
      continue;
    }

    // Get Firestore document
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (!doc.exists) {
        console.log(`  ❌ NO Firestore document found for UID: ${uid}`);
      } else {
        const data = doc.data()!;
        console.log(`  Firestore roles: ${JSON.stringify(data.roles)}`);
        console.log(`  isActive    : ${data.isActive}`);
        console.log(`  status      : ${data.status}`);
        console.log(`  isBanned    : ${data.isBanned ?? "(not set)"}`);
        console.log(`  suspended   : ${data.suspended ?? "(not set)"}`);
        console.log(`  requiresPasswordChange: ${data.requiresPasswordChange ?? "(not set)"}`);
      }
    } catch (e: any) {
      console.log(`  ❌ Firestore read failed: ${e.message}`);
    }
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
