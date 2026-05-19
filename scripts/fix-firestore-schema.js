#!/usr/bin/env node
/**
 * fix-firestore-schema.js
 *
 * Comprehensive Firestore data migration for Easy Sales Export.
 *
 * Problems this fixes:
 * 1. `verified` field on user docs should also be written as `isVerified`
 *    (the code reads `isVerified` but old docs only have `verified`)
 * 2. Documents in academy_applications, cooperative_members, wave_applications
 *    that are missing `createdAt` / `submittedAt` — Firestore orderBy silently
 *    drops these, causing incomplete admin views.
 * 3. Users missing `createdAt` altogether (early registrations before the field
 *    was standardised).
 *
 * Usage:
 *   node scripts/fix-firestore-schema.js [--dry-run]
 *
 * Flags:
 *   --dry-run   Print what would change without writing to Firestore.
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS  must point to a service-account JSON file,
 *   OR FIREBASE_SERVICE_ACCOUNT env var must contain the raw JSON.
 *
 *   npm install firebase-admin   (already in devDependencies)
 */

const admin = require("firebase-admin");

// ── Initialise Admin SDK ────────────────────────────────────────────────────
function initAdmin() {
  if (admin.apps.length > 0) return;

  const path = require("path");
  const fs = require("fs");

  // Load .env.local using dotenv if possible
  try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
    }
  } catch (e) {
    warn("Failed to load dotenv configuration: " + e.message);
  }

  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (jsonEnv) {
    const serviceAccount = JSON.parse(jsonEnv);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return;
  }

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath) {
    const serviceAccount = require(keyPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return;
  }

  // Support individual FIREBASE_ env variables as standard in Easy Sales Export
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    return;
  }

  // Try .env.local manual parser if dotenv failed
  const envLocal = path.resolve(__dirname, "../.env.local");
  if (fs.existsSync(envLocal)) {
    const lines = fs.readFileSync(envLocal, "utf8").split("\n");
    for (const line of lines) {
      const [key, ...rest] = line.split("=");
      if (key && key.trim() === "FIREBASE_SERVICE_ACCOUNT") {
        const val = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
        const serviceAccount = JSON.parse(val);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        return;
      }
    }
  }

  throw new Error(
    "Firebase Admin not initialised. " +
    "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT."
  );
}

const DRY_RUN = process.argv.includes("--dry-run");

// ── Helpers ─────────────────────────────────────────────────────────────────
const FieldValue = admin.firestore.FieldValue;
const Timestamp  = admin.firestore.Timestamp;

function log(msg) { console.log(msg); }
function warn(msg) { console.warn("  ⚠️  " + msg); }

/** Write update (or log in dry-run) */
async function safeUpdate(docRef, data) {
  if (DRY_RUN) {
    log(`    [DRY] Would update ${docRef.path}: ${JSON.stringify(Object.keys(data))}`);
    return;
  }
  await docRef.update(data);
}

/** Process a collection in batches of 500 */
async function processCollection({ db, name, batchSize = 400, transform }) {
  log(`\n📦 Processing collection: ${name}`);
  let total = 0, updated = 0;
  let lastDoc = null;

  while (true) {
    let query = db.collection(name).limit(batchSize);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchHasUpdates = false;

    for (const doc of snap.docs) {
      total++;
      const patch = await transform(doc);
      if (patch && Object.keys(patch).length > 0) {
        if (DRY_RUN) {
          log(`    [DRY] Would update ${doc.ref.path}: ${JSON.stringify(Object.keys(patch))}`);
        } else {
          batch.update(doc.ref, patch);
          batchHasUpdates = true;
        }
        updated++;
      }
    }

    if (!DRY_RUN && batchHasUpdates) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    log(`    - Progress: ${total} documents scanned...`);
    if (snap.docs.length < batchSize) break;
  }

  log(`  ✅ Scanned ${total}, updated ${updated}`);
  return { total, updated };
}

// ── A fallback timestamp when none exists ───────────────────────────────────
// Use Jan 1 2025 as a safe "ancient" sentinel — sorts docs to bottom.
const SENTINEL_TS = Timestamp.fromDate(new Date("2025-01-01T00:00:00Z"));

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 1: users — sync verified → isVerified, backfill createdAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateUsers(db) {
  await processCollection({
    db,
    name: "users",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};

      // 1. verified / isVerified sync
      //    The TypeScript type has `verified: boolean` but the admin query
      //    filters on `isVerified`. Ensure both are always written.
      if (d.verified !== undefined && d.isVerified === undefined) {
        patch.isVerified = d.verified;
        log(`    🔄 users/${doc.id}: backfill isVerified=${d.verified}`);
      }
      if (d.isVerified !== undefined && d.verified === undefined) {
        patch.verified = d.isVerified;
        log(`    🔄 users/${doc.id}: backfill verified=${d.isVerified}`);
      }

      // 2. createdAt missing
      if (!d.createdAt) {
        patch.createdAt = SENTINEL_TS;
        warn(`users/${doc.id}: missing createdAt — set to sentinel`);
      }

      // 3. updatedAt missing
      if (!d.updatedAt) {
        patch.updatedAt = d.createdAt || SENTINEL_TS;
      }

      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 2: academy_applications — backfill submittedAt + createdAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateAcademyApplications(db) {
  await processCollection({
    db,
    name: "academy_applications",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};

      if (!d.submittedAt) {
        // Try to derive from createdAt, or fallback to sentinel
        patch.submittedAt = d.createdAt || SENTINEL_TS;
        warn(`academy_applications/${doc.id}: missing submittedAt — backfilled`);
      }
      if (!d.createdAt) {
        patch.createdAt = d.submittedAt || SENTINEL_TS;
        warn(`academy_applications/${doc.id}: missing createdAt — backfilled`);
      }

      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 3: cooperative_members — backfill createdAt + updatedAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateCooperativeMembers(db) {
  await processCollection({
    db,
    name: "cooperative_members",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};

      if (!d.createdAt) {
        patch.createdAt = SENTINEL_TS;
        warn(`cooperative_members/${doc.id}: missing createdAt — backfilled`);
      }
      if (!d.updatedAt) {
        patch.updatedAt = d.createdAt || SENTINEL_TS;
      }

      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 4: cooperative_onboarding_applications — backfill submittedAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateCoopOnboarding(db) {
  await processCollection({
    db,
    name: "cooperative_onboarding_applications",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};

      if (!d.submittedAt) {
        patch.submittedAt = d.createdAt || SENTINEL_TS;
        warn(`cooperative_onboarding_applications/${doc.id}: missing submittedAt — backfilled`);
      }
      if (!d.createdAt) {
        patch.createdAt = SENTINEL_TS;
        warn(`cooperative_onboarding_applications/${doc.id}: missing createdAt — backfilled`);
      }

      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 5: wave_applications — backfill createdAt + submittedAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateWaveApplications(db) {
  await processCollection({
    db,
    name: "wave_applications",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};

      if (!d.createdAt) {
        patch.createdAt = d.submittedAt || d.applicationDate || SENTINEL_TS;
        warn(`wave_applications/${doc.id}: missing createdAt — backfilled`);
      }
      if (!d.submittedAt && d.status && d.status !== "draft") {
        patch.submittedAt = d.createdAt || SENTINEL_TS;
        warn(`wave_applications/${doc.id}: missing submittedAt — backfilled`);
      }

      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 6: loan_applications — backfill createdAt + appliedAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateLoanApplications(db) {
  await processCollection({
    db,
    name: "loan_applications",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};

      if (!d.createdAt) {
        patch.createdAt = d.appliedAt || SENTINEL_TS;
        warn(`loan_applications/${doc.id}: missing createdAt — backfilled`);
      }
      if (!d.appliedAt) {
        patch.appliedAt = d.createdAt || SENTINEL_TS;
      }

      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 7: wave_withdrawals — backfill createdAt from requestedAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateWaveWithdrawals(db) {
  await processCollection({
    db,
    name: "wave_withdrawals",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};

      if (!d.createdAt && d.requestedAt) {
        patch.createdAt = d.requestedAt;
      }
      if (!d.requestedAt && d.createdAt) {
        patch.requestedAt = d.createdAt;
      }

      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 8: withdrawals (standard) — backfill createdAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateWithdrawals(db) {
  await processCollection({
    db,
    name: "withdrawals",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};
      if (!d.createdAt) {
        patch.createdAt = d.requestedAt || SENTINEL_TS;
        warn(`withdrawals/${doc.id}: missing createdAt — backfilled`);
      }
      return patch;
    },
  });

  await processCollection({
    db,
    name: "cooperative_withdrawals",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};
      if (!d.createdAt) {
        patch.createdAt = d.requestedAt || SENTINEL_TS;
        warn(`cooperative_withdrawals/${doc.id}: missing createdAt — backfilled`);
      }
      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 9: seller_verifications — backfill createdAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateSellerVerifications(db) {
  await processCollection({
    db,
    name: "seller_verifications",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};
      if (!d.createdAt) {
        patch.createdAt = SENTINEL_TS;
        warn(`seller_verifications/${doc.id}: missing createdAt`);
      }
      return patch;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION 10: export_onboarding_applications — backfill createdAt
// ─────────────────────────────────────────────────────────────────────────────
async function migrateExportApplications(db) {
  await processCollection({
    db,
    name: "export_onboarding_applications",
    transform: (doc) => {
      const d = doc.data();
      const patch = {};
      if (!d.createdAt) {
        patch.createdAt = d.submittedAt || SENTINEL_TS;
        warn(`export_onboarding_applications/${doc.id}: missing createdAt`);
      }
      if (!d.submittedAt) {
        patch.submittedAt = d.createdAt || SENTINEL_TS;
        warn(`export_onboarding_applications/${doc.id}: missing submittedAt`);
      }
      return patch;
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────────────────────────────
(async () => {
  initAdmin();
  const db = admin.firestore();

  if (DRY_RUN) {
    log("🚨  DRY RUN MODE — no data will be written\n");
  } else {
    log("🔥  LIVE MODE — writing to Firestore\n");
  }

  const start = Date.now();

  await migrateUsers(db);
  await migrateAcademyApplications(db);
  await migrateCooperativeMembers(db);
  await migrateCoopOnboarding(db);
  await migrateWaveApplications(db);
  await migrateLoanApplications(db);
  await migrateWaveWithdrawals(db);
  await migrateWithdrawals(db);
  await migrateSellerVerifications(db);
  await migrateExportApplications(db);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`\n✅  All migrations complete in ${elapsed}s`);
  if (DRY_RUN) {
    log("Re-run without --dry-run to apply changes.");
  }
})().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
