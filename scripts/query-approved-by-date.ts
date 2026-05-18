/**
 * query-approved-by-date.ts
 * 
 * Fetches cooperative members approved between two dates and prints their details.
 * 
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/query-approved-by-date.ts
 */

import { db } from "../src/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

const FROM_DATE = new Date("2026-05-15T00:00:00.000+01:00");
const TO_DATE   = new Date("2026-05-18T23:59:59.999+01:00");

function formatDate(val: any): string {
    if (!val) return "—";
    if (val?.seconds) return new Date(val.seconds * 1000).toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
    if (val instanceof Date) return val.toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
    return String(val);
}

async function main() {
    console.log(`\n🔍 Cooperative members approved between`);
    console.log(`   FROM: ${FROM_DATE.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}`);
    console.log(`   TO  : ${TO_DATE.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}\n`);

    // Query by approvedAt first
    const snap = await db
        .collection("cooperative_members")
        .where("approvedAt", ">=", Timestamp.fromDate(FROM_DATE))
        .where("approvedAt", "<=", Timestamp.fromDate(TO_DATE))
        .orderBy("approvedAt", "asc")
        .get();

    console.log(`Found ${snap.size} member(s) approved in this date range.\n`);

    if (snap.size === 0) {
        // Fallback: check updatedAt for members that may have been backfilled
        console.log("⚠️  No results on approvedAt — trying backfilledAt (backfill ran today)...\n");
        const snap2 = await db
            .collection("cooperative_members")
            .where("_backfilledAt", ">=", Timestamp.fromDate(FROM_DATE))
            .where("_backfilledAt", "<=", Timestamp.fromDate(TO_DATE))
            .orderBy("_backfilledAt", "asc")
            .get();
        console.log(`Found ${snap2.size} member(s) via _backfilledAt.\n`);
        if (snap2.size > 0) {
            await printResults(snap2.docs);
        }
        return;
    }

    await printResults(snap.docs);
    process.exit(0);
}

async function printResults(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
    // Fetch all user profiles in batch
    const userIds = [...new Set(docs.map(d => d.data().userId || d.id).filter(Boolean))];
    const userMap = new Map<string, any>();
    for (let i = 0; i < userIds.length; i += 30) {
        const chunk = userIds.slice(i, i + 30);
        const snap = await db.collection("users").where("__name__", "in", chunk).get();
        snap.docs.forEach(d => userMap.set(d.id, d.data()));
    }

    const rows: any[] = [];

    docs.forEach((doc, idx) => {
        const m  = doc.data();
        const u  = userMap.get(m.userId || doc.id) || {};
        const no = idx + 1;

        const fullName = [m.firstName, m.lastName].filter(Boolean).join(" ")
            || [u.firstName, u.lastName].filter(Boolean).join(" ")
            || u.fullName || u.name || "Unknown";

        const email   = m.email   || u.email   || "—";
        const phone   = m.phone   || m.phoneNumber || u.phone || u.phoneNumber || "—";
        const state   = m.stateOfOrigin || u.stateOfOrigin || "—";
        const status  = m.membershipStatus || "—";
        const payment = m.paymentStatus   || "—";
        const approved= formatDate(m.approvedAt);
        const approvedBy = m.approvedBy || "—";
        const tier    = m.membershipTier || "Member";

        rows.push({
            "#": no,
            "Member ID": doc.id,
            "Full Name": fullName,
            "Email": email,
            "Phone": phone,
            "State": state,
            "Tier": tier,
            "Membership Status": status,
            "Payment Status": payment,
            "Approved At": approved,
            "Approved By": approvedBy,
        });

        // Print inline block
        console.log(`── ${no}. ${fullName} ──────────────────────────────`);
        console.log(`   Member ID  : ${doc.id}`);
        console.log(`   Email      : ${email}`);
        console.log(`   Phone      : ${phone}`);
        console.log(`   State      : ${state}`);
        console.log(`   Tier       : ${tier}`);
        console.log(`   Status     : ${status}`);
        console.log(`   Payment    : ${payment}`);
        console.log(`   Approved At: ${approved}`);
        console.log(`   Approved By: ${approvedBy}`);
        console.log();
    });

    // Summary table
    console.log("════════════════════════ SUMMARY TABLE ════════════════════════");
    console.log(
        "#".padEnd(4) +
        "Name".padEnd(28) +
        "Email".padEnd(36) +
        "Phone".padEnd(16) +
        "Status".padEnd(12) +
        "Payment".padEnd(12) +
        "Approved At"
    );
    console.log("─".repeat(120));
    rows.forEach(r => {
        console.log(
            String(r["#"]).padEnd(4) +
            r["Full Name"].substring(0, 26).padEnd(28) +
            r["Email"].substring(0, 34).padEnd(36) +
            r["Phone"].substring(0, 14).padEnd(16) +
            r["Membership Status"].padEnd(12) +
            r["Payment Status"].padEnd(12) +
            r["Approved At"]
        );
    });
    console.log("─".repeat(120));
    console.log(`\nTotal: ${rows.length} member(s)\n`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
