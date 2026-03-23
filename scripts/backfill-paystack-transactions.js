/**
 * backfill-paystack-transactions.js
 *
 * Fetches ALL historical transactions from Paystack (no date limit)
 * and backfills into Firestore:
 *   - status=success   → processedPayments (doc ID = reference, idempotent)
 *   - status=failed    → failedPayments
 *   - status=abandoned → failedPayments
 *
 * Usage:
 *   node scripts/backfill-paystack-transactions.js
 *
 * IDEMPOTENT: uses Paystack reference as Firestore doc ID.
 * Running multiple times is safe — already-existing docs are skipped.
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllTransactions() {
    const all = [];
    let page = 1;
    const perPage = 100;
    let totalPages = null;

    while (true) {
        // No date filter — fetch ALL historical transactions
        const url = `/transaction?perPage=${perPage}&page=${page}`;
        process.stdout.write(`  Fetching page ${page}${totalPages ? `/${totalPages}` : ''}...`);
        const resp = await paystackGet(url);

        if (!resp.status || !resp.data) {
            console.log(` ERROR: ${JSON.stringify(resp).substring(0, 200)}`);
            break;
        }
        if (resp.data.length === 0) { console.log(' done.'); break; }

        all.push(...resp.data);

        // Determine total pages from meta
        const meta = resp.meta || {};
        if (!totalPages && meta.pageCount) totalPages = meta.pageCount;
        const total = meta.total || '?';
        console.log(` got ${resp.data.length} (total so far: ${all.length}/${total})`);

        if (resp.data.length < perPage || (totalPages && page >= totalPages)) break;
        page++;
        await sleep(250); // stay within Paystack rate limit
    }
    return all;
}

async function processBatch(txList, successCount, failedCount, abandonedCount, skippedCount) {
    const tasks = txList.map(async (tx) => {
        const reference = tx.reference;
        const amount = tx.amount / 100;
        const status = tx.status;
        const metadata = tx.metadata || {};
        const userId = metadata.userId || null;
        const type = metadata.type || null;
        const channel = tx.channel || null;
        const currency = tx.currency || "NGN";
        const gatewayResponse = tx.gateway_response || null;
        const paidAt = tx.paid_at || tx.created_at || null;

        if (status === "success") {
            const ref = db.collection("processedPayments").doc(reference);
            const existing = await ref.get();
            if (existing.exists) { skippedCount.v++; return; }
            await ref.set({
                reference,
                type: type || "unknown",
                userId,
                amount,
                plan: metadata.plan || null,
                tier: metadata.membershipTier || null,
                exportId: metadata.exportId || null,
                channel, currency,
                status: "completed",
                processedAt: paidAt ? new Date(paidAt) : FieldValue.serverTimestamp(),
                customerEmail: tx.customer?.email || null,
                customerName: tx.customer?.first_name ? `${tx.customer.first_name} ${tx.customer.last_name || ''}`.trim() : null,
                source: "paystack_backfill",
                paystackMetadata: metadata,
            });
            successCount.v++;

            // Auto-create academy_applications if needed
            if (type === "academy_registration" && userId) {
                try {
                    const appRef = db.collection("academy_applications").doc(`BACKFILL-ACADEMY-${reference}`);
                    if (!(await appRef.get()).exists) {
                        const userData = (await db.collection("users").doc(userId).get()).data() || {};
                        await appRef.set({
                            userId, applicationId: `BACKFILL-ACADEMY-${reference}`,
                            personalInfo: { fullName: userData.fullName || userData.name || "Unknown", email: userData.email || "Unknown", phone: userData.phone || "" },
                            education: { educationLevel: "Not provided (backfilled)", fieldOfStudy: "Not provided" },
                            status: "pending", paymentStatus: "completed",
                            paymentReference: reference, paymentAmount: amount,
                            plan: (metadata.plan || "foundation").toLowerCase(),
                            submittedAt: paidAt ? new Date(paidAt) : FieldValue.serverTimestamp(),
                            source: "paystack_backfill",
                        });
                    }
                } catch (e) { /* non-blocking */ }
            }

        } else if (status === "failed" || status === "abandoned") {
            const ref = db.collection("failedPayments").doc(reference);
            const existing = await ref.get();
            if (existing.exists) { skippedCount.v++; return; }
            await ref.set({
                reference, type: type || "unknown", userId, amount,
                status: status === "abandoned" ? "abandoned" : "failed",
                gatewayResponse: status === "abandoned" ? "Customer did not complete payment" : gatewayResponse,
                channel, currency,
                failedAt: paidAt ? new Date(paidAt) : FieldValue.serverTimestamp(),
                abandonedAt: status === "abandoned" ? (paidAt ? new Date(paidAt) : FieldValue.serverTimestamp()) : null,
                customerEmail: tx.customer?.email || null,
                paystackEvent: status === "abandoned" ? "charge.abandoned" : "charge.failed",
                source: "paystack_backfill", metadata,
            });
            if (status === "abandoned") abandonedCount.v++;
            else failedCount.v++;
        } else {
            skippedCount.v++;
        }
    });

    // Process 20 at a time to avoid hammering Firestore
    const BATCH = 20;
    for (let i = 0; i < tasks.length; i += BATCH) {
        await Promise.all(tasks.slice(i, i + BATCH));
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log("🚀 Paystack → Firestore Full Historical Backfill");
    console.log(`   Fetching ALL transactions (no date limit)...\n`);

    const transactions = await fetchAllTransactions();
    console.log(`\n📊 Total fetched from Paystack: ${transactions.length}\n`);

    const successCount = { v: 0 };
    const failedCount  = { v: 0 };
    const abandonedCount = { v: 0 };
    const skippedCount = { v: 0 };

    // Process in pages of 100 to show progress
    const PAGE = 100;
    for (let i = 0; i < transactions.length; i += PAGE) {
        const chunk = transactions.slice(i, i + PAGE);
        await processBatch(chunk, successCount, failedCount, abandonedCount, skippedCount);
        console.log(`  Processed ${Math.min(i + PAGE, transactions.length)}/${transactions.length} ` +
            `| ✅ ${successCount.v} success | ❌ ${failedCount.v} failed | 🔄 ${abandonedCount.v} abandoned | ⏭ ${skippedCount.v} skipped`);
    }

    console.log("\n" + "═".repeat(60));
    console.log("✨ Backfill Complete:");
    console.log(`   ✅ Written to processedPayments : ${successCount.v}`);
    console.log(`   ❌ Written to failedPayments    : ${failedCount.v + abandonedCount.v} (${failedCount.v} failed + ${abandonedCount.v} abandoned)`);
    console.log(`   ⏭  Skipped (already existed)   : ${skippedCount.v}`);
    console.log(`   📊 Total Paystack transactions  : ${transactions.length}`);
    console.log("═".repeat(60));
}

main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
});
