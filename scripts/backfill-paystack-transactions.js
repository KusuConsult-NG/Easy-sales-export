/**
 * backfill-paystack-transactions.js
 *
 * Pulls all transactions from the Paystack API between Feb 25 and Mar 23 2026
 * and backfills them into Firestore:
 *   - charge.success  → processedPayments (doc ID = reference, idempotent)
 *   - failed          → failedPayments
 *   - abandoned       → failedPayments
 *
 * Usage:
 *   node scripts/backfill-paystack-transactions.js
 *
 * Safe to re-run — uses Paystack reference as Firestore doc ID so duplicates
 * are simply skipped (set with merge:false on existing docs).
 */

const path = require("path");
const fs = require("fs");

// Read .env.local directly — bypasses shell env which may have a truncated FIREBASE_PRIVATE_KEY
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
        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        // Handle escaped newlines
        value = value.replace(/\\n/g, "\n");
        vars[key] = value;
    }
    return vars;
}
const envVars = readDotEnvLocal();

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const https = require("https");

// ─── Firebase Init ──────────────────────────────────────────────
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

// ─── Paystack Config ──────────────────────────────────────────────────────────
const PAYSTACK_SECRET_KEY = envVars.PAYSTACK_SECRET_KEY;
if (!PAYSTACK_SECRET_KEY) {
    console.error("❌ Missing PAYSTACK_SECRET_KEY in .env.local");
    process.exit(1);
}

// Date range: Feb 25, 2026 to Mar 23, 2026 (UTC)
const FROM_DATE = "2026-02-25";
const TO_DATE   = "2026-03-24"; // exclusive upper bound

// ─── Paystack API Helper ─────────────────────────────────────────────────────
function paystackGet(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: "api.paystack.co",
            path,
            method: "GET",
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
            },
        };
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("Failed to parse Paystack response")); }
            });
        });
        req.on("error", reject);
        req.end();
    });
}

async function fetchAllTransactions() {
    const all = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const url = `/transaction?from=${FROM_DATE}&to=${TO_DATE}&perPage=${perPage}&page=${page}`;
        console.log(`  Fetching page ${page}...`);
        const resp = await paystackGet(url);

        if (!resp.status || !resp.data || resp.data.length === 0) break;
        all.push(...resp.data);
        if (resp.data.length < perPage) break;
        page++;
    }
    return all;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log("🔍 Fetching transactions from Paystack API...");
    console.log(`   Date range: ${FROM_DATE} → ${TO_DATE}\n`);

    const transactions = await fetchAllTransactions();
    console.log(`📊 Found ${transactions.length} total transactions from Paystack\n`);

    let successCount = 0;
    let failedCount = 0;
    let abandonedCount = 0;
    let skippedCount = 0;

    for (const tx of transactions) {
        const reference = tx.reference;
        const amount = tx.amount / 100; // kobo → naira
        const status = tx.status; // "success", "failed", "abandoned"
        const metadata = tx.metadata || {};
        const userId = metadata.userId || tx.customer?.email || null;
        const type = metadata.type || null;
        const channel = tx.channel || null;
        const currency = tx.currency || "NGN";
        const gatewayResponse = tx.gateway_response || null;
        const paidAt = tx.paid_at || tx.created_at || null;

        if (status === "success") {
            const ref = db.collection("processedPayments").doc(reference);
            const existing = await ref.get();
            if (existing.exists) {
                console.log(`  ⏭  SKIP (already exists): ${reference} — ${type}`);
                skippedCount++;
                continue;
            }

            await ref.set({
                reference,
                type: type || "unknown",
                userId: userId || null,
                amount,
                plan: metadata.plan || null,
                tier: metadata.membershipTier || null,
                exportId: metadata.exportId || null,
                channel,
                currency,
                status: "completed",
                processedAt: paidAt ? new Date(paidAt) : FieldValue.serverTimestamp(),
                source: "paystack_backfill",
                paystackMetadata: metadata,
            });
            console.log(`  ✅ processedPayments: ${reference} — ${type || "unknown"} — ₦${amount}`);
            successCount++;

            // Also backfill academy_applications if academy_registration
            if (type === "academy_registration" && userId) {
                try {
                    const applicationId = `BACKFILL-ACADEMY-${reference}`;
                    const appRef = db.collection("academy_applications").doc(applicationId);
                    const appExisting = await appRef.get();
                    if (!appExisting.exists) {
                        const userSnap = await db.collection("users").doc(userId).get();
                        const userData = userSnap.data() || {};
                        await appRef.set({
                            userId,
                            applicationId,
                            personalInfo: {
                                fullName: userData.fullName || userData.name || "Unknown",
                                email: userData.email || "Unknown",
                                phone: userData.phone || userData.phoneNumber || "",
                            },
                            education: {
                                educationLevel: "Not provided (backfilled from Paystack)",
                                fieldOfStudy: "Not provided",
                            },
                            status: "pending",
                            paymentStatus: "completed",
                            paymentReference: reference,
                            paymentAmount: amount,
                            plan: (metadata.plan || "foundation").toLowerCase(),
                            submittedAt: paidAt ? new Date(paidAt) : FieldValue.serverTimestamp(),
                            source: "paystack_backfill",
                        });
                        console.log(`     📋 academy_applications created for ${userId}`);
                    }
                } catch (e) {
                    console.warn(`     ⚠️  academy_applications create failed for ${reference}:`, e.message);
                }
            }

        } else if (status === "failed") {
            const ref = db.collection("failedPayments").doc(reference);
            const existing = await ref.get();
            if (existing.exists) {
                skippedCount++;
                console.log(`  ⏭  SKIP failed (exists): ${reference}`);
                continue;
            }
            await ref.set({
                reference,
                type: type || "unknown",
                userId: userId || null,
                amount,
                status: "failed",
                gatewayResponse,
                channel,
                currency,
                failedAt: paidAt ? new Date(paidAt) : FieldValue.serverTimestamp(),
                paystackEvent: "charge.failed",
                source: "paystack_backfill",
                metadata,
            });
            console.log(`  ❌ failedPayments: ${reference} — ₦${amount}`);
            failedCount++;

        } else if (status === "abandoned") {
            const ref = db.collection("failedPayments").doc(reference);
            const existing = await ref.get();
            if (existing.exists) {
                skippedCount++;
                console.log(`  ⏭  SKIP abandoned (exists): ${reference}`);
                continue;
            }
            await ref.set({
                reference,
                type: type || "unknown",
                userId: userId || null,
                amount,
                status: "abandoned",
                gatewayResponse: "Customer did not complete payment",
                channel,
                currency,
                abandonedAt: paidAt ? new Date(paidAt) : FieldValue.serverTimestamp(),
                failedAt: paidAt ? new Date(paidAt) : FieldValue.serverTimestamp(),
                paystackEvent: "charge.abandoned",
                source: "paystack_backfill",
                metadata,
            });
            console.log(`  🕐 failedPayments (abandoned): ${reference} — ₦${amount}`);
            abandonedCount++;
        } else {
            console.log(`  ⚠️  UNKNOWN STATUS "${status}": ${reference} — skipping`);
            skippedCount++;
        }
    }

    console.log("\n" + "═".repeat(60));
    console.log("✨ Backfill Complete:");
    console.log(`   ✅ Successful  → processedPayments : ${successCount}`);
    console.log(`   ❌ Failed      → failedPayments    : ${failedCount}`);
    console.log(`   🕐 Abandoned   → failedPayments    : ${abandonedCount}`);
    console.log(`   ⏭  Skipped (already existed)       : ${skippedCount}`);
    console.log(`   📊 Total Paystack transactions      : ${transactions.length}`);
    console.log("═".repeat(60));
}

main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
});
