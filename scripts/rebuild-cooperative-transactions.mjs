/**
 * rebuild-cooperative-transactions.mjs
 *
 * Source of truth: Paystack's /transaction API (successful payments only).
 *
 * Steps:
 *  1. Fetch ALL successful transactions from Paystack (all pages).
 *  2. Filter to cooperative_membership_registration only.
 *  3. DELETE every existing document in cooperative_transactions.
 *  4. Write exactly one authoritative record per Paystack transaction.
 *
 * Run: node scripts/rebuild-cooperative-transactions.mjs
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Firebase init ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = readFileSync(resolve(__dirname, "../.env.production.local"), "utf8");
const envVars = Object.fromEntries(
    envFile.split("\n")
        .filter(l => l.includes("=") && !l.startsWith("#"))
        .map(l => {
            const idx = l.indexOf("=");
            return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^"|"$/g, "")];
        })
);

const PAYSTACK_SECRET_KEY = envVars.PAYSTACK_SECRET_KEY;
if (!PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY not found in .env.production.local");

// Parse private key (handles escaped newlines from env files)
const privateKey = envVars.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!privateKey) throw new Error("FIREBASE_PRIVATE_KEY not found in .env.production.local");

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: envVars.FIREBASE_PROJECT_ID || "easy-sales-hub",
            clientEmail: envVars.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

const db = getFirestore();
db.settings({ preferRest: true, ignoreUndefinedProperties: true });

// ── Paystack helpers ─────────────────────────────────────────────────────────
async function fetchAllSuccessfulPaystackTransactions() {
    const all = [];
    let page = 1;

    while (true) {
        const url = `https://api.paystack.co/transaction?perPage=100&page=${page}&status=success`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        });
        if (!res.ok) throw new Error(`Paystack API error: ${res.status} ${res.statusText}`);
        const json = await res.json();
        const rows = json.data ?? [];
        all.push(...rows);

        const totalPages = json.meta?.pageCount ?? 1;
        console.log(`  Paystack page ${page}/${totalPages} — ${rows.length} transactions fetched`);
        if (page >= totalPages || rows.length === 0) break;
        page++;
    }

    return all;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log("\n=== STEP 1: Fetch all successful Paystack transactions ===");
    const allSuccess = await fetchAllSuccessfulPaystackTransactions();
    console.log(`Total successful Paystack transactions: ${allSuccess.length}`);

    // Filter to cooperative membership registrations only
    // Support both 'type' and legacy 'purpose' metadata keys
    const coopTxs = allSuccess.filter(tx => {
        const meta = tx.metadata || {};
        const type = meta.type || meta.purpose || "";
        return type === "cooperative_membership_registration";
    });

    console.log(`\nCooperative membership payments (source of truth): ${coopTxs.length}`);
    const totalAmount = coopTxs.reduce((s, tx) => s + tx.amount, 0) / 100;
    console.log(`Total cooperative amount from Paystack: ₦${totalAmount.toLocaleString()}`);

    if (coopTxs.length === 0) {
        console.error("\n❌ No cooperative transactions found on Paystack. Aborting — not deleting anything.");
        process.exit(1);
    }

    // ── STEP 2: Wipe cooperative_transactions collection ────────────────────
    console.log("\n=== STEP 2: Wipe ALL existing cooperative_transactions ===");
    const existingSnap = await db.collection("cooperative_transactions").get();
    console.log(`Deleting ${existingSnap.size} existing documents...`);

    // Firestore batch delete in chunks of 500
    const batches = [];
    let batch = db.batch();
    let count = 0;
    for (const doc of existingSnap.docs) {
        batch.delete(doc.ref);
        count++;
        if (count % 500 === 0) {
            batches.push(batch.commit());
            batch = db.batch();
        }
    }
    if (count % 500 !== 0) batches.push(batch.commit());
    await Promise.all(batches);
    console.log(`✅ Deleted ${existingSnap.size} corrupt/duplicate records.`);

    // ── STEP 3: Rebuild from Paystack data ──────────────────────────────────
    console.log("\n=== STEP 3: Rebuild cooperative_transactions from Paystack ===");

    let written = 0;
    let writeBatch = db.batch();
    let batchCount = 0;

    for (const tx of coopTxs) {
        const meta = tx.metadata || {};
        const amountNaira = tx.amount / 100;
        const ref = tx.reference;

        // Use Paystack reference as the Firestore document ID — guarantees idempotency
        const docRef = db.collection("cooperative_transactions").doc(ref);

        writeBatch.set(docRef, {
            // Identity
            paystackReference: ref,
            reference: ref,

            // Who paid
            userId: meta.userId || meta.membershipId || null,
            membershipId: meta.membershipId || meta.userId || null,
            membershipTier: (meta.membershipTier || meta.plan || "basic").toLowerCase(),

            // What was paid
            type: "registration_fee",
            amount: amountNaira,
            currency: tx.currency || "NGN",

            // When
            date: tx.paid_at ? new Date(tx.paid_at) : new Date(tx.created_at),
            paidAt: tx.paid_at ? new Date(tx.paid_at) : new Date(tx.created_at),

            // Status — from Paystack directly, never inferred
            status: "completed",
            paystackStatus: tx.status,

            // Channel (card / bank_transfer / ussd etc.)
            channel: tx.channel || null,
            customerEmail: tx.customer?.email || null,

            // Lineage — always know where this data came from
            source: "paystack_authoritative_rebuild",
            description: "Cooperative Registration Fee",
            cooperativeId: "default",
        });

        written++;
        batchCount++;

        if (batchCount === 500) {
            await writeBatch.commit();
            writeBatch = db.batch();
            batchCount = 0;
            console.log(`  Written ${written} records so far...`);
        }
    }

    if (batchCount > 0) await writeBatch.commit();

    console.log(`\n✅ Rebuilt ${written} authoritative cooperative_transactions records.`);
    console.log(`✅ Total amount: ₦${totalAmount.toLocaleString()}`);
    console.log("\n=== Summary ===");
    console.log(`  Paystack confirmed payments : ${coopTxs.length}`);
    console.log(`  Records written to Firestore: ${written}`);
    console.log(`  Corrupt duplicates deleted  : ${existingSnap.size}`);
    console.log(`  Net correction              : ${existingSnap.size - written} records removed`);
    console.log("\nDone. The dashboard will now show accurate, Paystack-authoritative figures.");
}

main().catch(err => {
    console.error("\n❌ Fatal error:", err.message);
    process.exit(1);
});
