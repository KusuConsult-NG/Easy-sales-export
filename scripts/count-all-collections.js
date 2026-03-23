/**
 * count-all-collections.js
 * Counts documents across all admin-facing Firestore collections
 */

const path = require("path");
const fs = require("fs");

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
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        value = value.replace(/\\n/g, "\n");
        vars[key] = value;
    }
    return vars;
}

const envVars = readDotEnvLocal();
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
    initializeApp({ credential: cert({ projectId: envVars.FIREBASE_PROJECT_ID, clientEmail: envVars.FIREBASE_CLIENT_EMAIL, privateKey: envVars.FIREBASE_PRIVATE_KEY }) });
}
const db = getFirestore();

const COLS = [
  // Payments
  { c: "processedPayments", label: "All processed Paystack payments" },
  { c: "failedPayments", label: "Failed/abandoned Paystack payments" },
  // Academy
  { c: "academy_applications", label: "Academy applications" },
  { c: "academy_applications", filter: { f: "paymentStatus", op: "==", v: "completed" }, label: "Academy apps (payment completed)" },
  // WAVE
  { c: "wave_applications", label: "WAVE applications" },
  { c: "wave_briefing_registrations", label: "WAVE briefing registrations" },
  // Cooperative
  { c: "cooperative_members", label: "Cooperative members (all)" },
  { c: "cooperative_members", filter: { f: "paymentStatus", op: "==", v: "completed" }, label: "Cooperative members (payment completed)" },
  { c: "cooperative_members", filter: { f: "membershipStatus", op: "==", v: "pending" }, label: "Cooperative members (awaiting approval)" },
  { c: "cooperative_transactions", label: "Cooperative transactions" },
  { c: "cooperative_transactions", filter: { f: "type", op: "==", v: "membership_registration" }, label: "  → membership_registration" },
  { c: "cooperative_loans", label: "Cooperative loans" },
  // Land listings
  { c: "land_listings", label: "Land listings" },
  { c: "land_listings", filter: { f: "status", op: "==", v: "active" }, label: "  → active" },
  { c: "land_listings", filter: { f: "status", op: "==", v: "pending_verification" }, label: "  → pending verification" },
  // Marketplace
  { c: "seller_verifications", label: "Seller verifications" },
  { c: "seller_verifications", filter: { f: "status", op: "==", v: "pending" }, label: "  → pending" },
  { c: "marketplace_orders", label: "Marketplace orders" },
  { c: "escrow_transactions", label: "Escrow transactions" },
  { c: "escrow_transactions", filter: { f: "status", op: "==", v: "pending" }, label: "  → pending" },
  // Export
  { c: "export_applications", label: "Export applications" },
  { c: "export_applications", filter: { f: "status", op: "==", v: "pending_review" }, label: "  → pending review" },
  // Users
  { c: "users", label: "Total users" },
  // Audits / withdrawals
  { c: "audit_logs", label: "Audit logs" },
  { c: "withdrawal_requests", label: "Cooperative withdrawal requests" },
  { c: "wave_withdrawals", label: "WAVE withdrawal requests" },
];

async function countCol(col, filter) {
    try {
        let q = db.collection(col);
        if (filter) q = q.where(filter.f, filter.op, filter.v);
        const snap = await q.count().get();
        return snap.data().count;
    } catch(e) {
        return `ERR: ${e.message.substring(0, 60)}`;
    }
}

async function main() {
    console.log("📊 Firestore Collection Counts\n");
    let lastCol = null;
    for (const { c, filter, label } of COLS) {
        if (c !== lastCol && !label.startsWith("  →")) {
            console.log("");
            lastCol = c;
        }
        const count = await countCol(c, filter);
        console.log(`  ${String(count).padStart(6)}  ${label}`);
    }
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
