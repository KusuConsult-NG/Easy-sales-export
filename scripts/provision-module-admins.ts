/**
 * provision-module-admins.ts
 *
 * Definitive one-shot provisioning for all 6 module admin accounts.
 * For each account this script:
 *  1. Looks up (or creates) the Firebase Auth user
 *  2. Resets the password to the exact new details provided by the user
 *  3. Sets Firebase custom claims: { admin: true, roles: [...] }
 *  4. Upserts the Firestore /users/{uid} document with the same roles
 *  5. Deletes every Redis cache key for that user so the next login
 *     picks up fresh data (no stale session roles)
 *
 * Run:
 *   npx tsx scripts/provision-module-admins.ts
 */

import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from .env.local BEFORE importing firebase-admin
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { adminAuth, db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

interface ModuleAdminConfig {
  email: string;
  password: string;
  displayName: string;
  /** The specific admin roles assigned to this module admin */
  roles: string[];
  /** The admin silo path they should land on after login */
  expectedRedirect: string;
}

const MODULE_ADMINS: ModuleAdminConfig[] = [
  {
    email: "easysaleswave@gmail.com",
    password: "WaveAdmin2026",
    displayName: "WAVE Admin",
    roles: ["wave_admin", "admin"],
    expectedRedirect: "/admin/wave",
  },
  {
    email: "easysalescooperative@gmail.com",
    password: "coopAdmin2026",
    displayName: "Cooperative Admin",
    roles: ["cooperative_admin", "admin"],
    expectedRedirect: "/admin/cooperatives",
  },
  {
    email: "easysalesmarketplace@gmail.com",
    password: "MktAdmin2026",
    displayName: "Marketplace Admin",
    roles: ["marketplace_admin", "admin"],
    expectedRedirect: "/admin/marketplace",
  },
  {
    email: "easysalesexportwindow@gmail.com",
    password: "ExportAdmin2026",
    displayName: "Export Window Admin",
    roles: ["export_admin", "admin"],
    expectedRedirect: "/admin/export",
  },
  {
    email: "easysalesfarmnation@gmail.com",
    password: "FarmAdmin2026",
    displayName: "Farm Nation Admin",
    // Assign BOTH 'farm_nation_admin' (used in routing/permissions) and 'farmnation_admin' (used in messages.ts)
    roles: ["farm_nation_admin", "farmnation_admin", "admin"],
    expectedRedirect: "/admin/farm-nation",
  },
  {
    email: "academy.easysalesexport1@gmail.com",
    password: "AcadAdmin2026",
    displayName: "Academy Admin",
    roles: ["academy_admin", "admin"],
    expectedRedirect: "/admin/academy",
  },
];

async function provision(cfg: ModuleAdminConfig): Promise<void> {
  const { email, password, displayName, roles, expectedRedirect } = cfg;

  console.log(`\n── ${email} ─────────────────────────────────`);
  console.log(`   roles      : ${roles.join(", ")}`);
  console.log(`   expected   : ${expectedRedirect}`);

  // ── 0. Firestore pre-check: see if document already exists to get its UID ──
  let existingFirestoreUid: string | null = null;
  try {
    const snap = await db.collection("users").where("email", "==", email).limit(1).get();
    if (!snap.empty) {
      existingFirestoreUid = snap.docs[0].id;
      console.log(`   Firestore  : Found existing document with UID: ${existingFirestoreUid}`);
    }
  } catch (err: any) {
    console.warn(`   Firestore  : Error during pre-check: ${err.message}`);
  }

  // ── 1. Firebase Auth: create or update ───────────────────────────────────
  let uid: string;
  let authUser;

  try {
    authUser = await adminAuth.getUserByEmail(email);
    uid = authUser.uid;
    await adminAuth.updateUser(uid, {
      password,
      displayName,
      emailVerified: true,
      disabled: false,
    });
    console.log(`   Auth       : ✅ exists by email (UID: ${uid}) — updated`);
  } catch (e: any) {
    if (e.code === "auth/user-not-found") {
      console.log(`   Auth       : Email not found. Checking if UID exists in Auth...`);
      if (existingFirestoreUid) {
        try {
          await adminAuth.updateUser(existingFirestoreUid, {
            email,
            password,
            displayName,
            emailVerified: true,
            disabled: false,
          });
          authUser = await adminAuth.getUser(existingFirestoreUid);
          uid = authUser.uid;
          console.log(`   Auth       : ✅ exists by UID (UID: ${uid}) — updated with email/password`);
        } catch (uidErr: any) {
          if (uidErr.code === "auth/user-not-found") {
            console.log(`   Auth       : UID not found either. Creating new user...`);
            const created = await adminAuth.createUser({
              uid: existingFirestoreUid,
              email,
              password,
              displayName,
              emailVerified: true,
            });
            uid = created.uid;
            console.log(`   Auth       : 🆕 created (UID: ${uid})`);
          } else {
            console.error(`   Auth       : ❌ FAILED by UID — ${uidErr.message}`);
            return;
          }
        }
      } else {
        // No existing Firestore UID. Let Firebase generate one.
        const created = await adminAuth.createUser({
          email,
          password,
          displayName,
          emailVerified: true,
        });
        uid = created.uid;
        console.log(`   Auth       : 🆕 created with new UID (UID: ${uid})`);
      }
    } else {
      console.error(`   Auth       : ❌ FAILED by Email — ${e.message}`);
      return;
    }
  }

  // ── 2. Firebase Custom Claims ─────────────────────────────────────────────
  try {
    await adminAuth.setCustomUserClaims(uid, { admin: true, roles, role: roles[0] });
    console.log(`   Claims     : ✅ set — { admin: true, roles: [${roles.join(", ")}] }`);
  } catch (e: any) {
    console.error(`   Claims     : ❌ FAILED — ${e.message}`);
  }

  // ── 3. Firestore /users/{uid} ─────────────────────────────────────────────
  try {
    const nameParts = displayName.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();

    const payload = {
      uid,
      email,
      fullName: displayName,
      firstName,
      lastName,
      roles,
      isActive: true,
      status: "active",
      emailVerified: true,
      verified: true,
      isVerified: true,
      profileComplete: true,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!snap.exists) {
      await ref.set({ ...payload, createdAt: FieldValue.serverTimestamp() });
      console.log(`   Firestore  : ✅ document created`);
    } else {
      await ref.update({
        ...payload,
        _version: FieldValue.increment(1)
      });
      console.log(`   Firestore  : ✅ document updated (roles synced)`);
    }

    // Also update the admin_roles collection for audit
    const adminRoleRef = db.collection("admin_roles").doc(uid);
    await adminRoleRef.set({
      uid: uid,
      email: email,
      role: roles[0],
      roles: roles,
      grantedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`   admin_roles: ✅ document upserted`);

  } catch (e: any) {
    console.error(`   Firestore  : ❌ FAILED — ${e.message}`);
  }

  // ── 4. Redis cache invalidation ───────────────────────────────────────────
  try {
    const { redis, CacheKeys } = await import("../src/lib/redis");
    await Promise.all([
      redis.del(CacheKeys.userProfile(uid)),
      redis.del(CacheKeys.userPermissions(uid)),
      redis.del(CacheKeys.userSession(uid)),
      redis.del(CacheKeys.userStats(uid)),
    ]);
    console.log(`   Redis      : ✅ all cache keys deleted`);
  } catch (e: any) {
    console.warn(`   Redis      : ⚠️  skipped/failed — ${e.message}`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Module Admin Provisioning — Easy Sales Export Platform");
  console.log("=".repeat(60));

  let ok = 0;
  let fail = 0;

  for (const cfg of MODULE_ADMINS) {
    try {
      await provision(cfg);
      ok++;
    } catch (e: any) {
      console.error(`\n❌ Fatal error for ${cfg.email}: ${e.message}`);
      fail++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  Done — ✅ ${ok} succeeded / ❌ ${fail} failed`);
  console.log("=".repeat(60));
  console.log("\nTest login at: http://localhost:3000/auth/login/admin");
  console.log("Each admin should redirect to their module silo:\n");
  MODULE_ADMINS.forEach((a) =>
    console.log(`  ${a.email.padEnd(45)} → ${a.expectedRedirect}`)
  );
  console.log("");

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
