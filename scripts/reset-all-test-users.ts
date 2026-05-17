/**
 * Bulk audit + reset all platform test accounts.
 * Run: NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local npx ts-node --compiler-options '{"module":"commonjs"}' scripts/reset-all-test-users.ts
 */
import { adminAuth, db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

interface TestAccount {
    email: string;
    password: string;
    displayName: string;
    roles: string[];
}

const ACCOUNTS: TestAccount[] = [
    // ── Marketplace ───────────────────────────────────────────────────────────
    {
        email: "easysalesmarketplace@gmail.com",
        password: "Marketplace@2026",
        displayName: "Marketplace Admin",
        roles: ["general_user", "admin", "marketplace_admin"],
    },
    {
        email: "marketplaceuser04@gmail.com",
        password: "Marketplace@2026",
        displayName: "Marketplace User 04",
        roles: ["general_user", "marketplace_member"],
    },
    // ── Export Window ─────────────────────────────────────────────────────────
    {
        email: "easysalesexportwindow@gmail.com",
        password: "Exportwindow@2026",
        displayName: "Export Window Admin",
        roles: ["general_user", "admin", "export_admin"],
    },
    {
        email: "exportwindowuser@gmail.com",
        password: "Exportwindow@2026",
        displayName: "Export Window User",
        roles: ["general_user", "export_member"],
    },
    // ── Farm Nation ───────────────────────────────────────────────────────────
    {
        email: "easysalesfarmnation@gmail.com",
        password: "Farmnation@2026",
        displayName: "Farm Nation Admin",
        roles: ["general_user", "admin", "farm_nation_admin"],
    },
    {
        email: "farmnationuser@gmail.com",
        password: "Farmnation@2026",
        displayName: "Farm Nation User",
        roles: ["general_user", "farm_nation_member"],
    },
    // ── Academy ───────────────────────────────────────────────────────────────
    {
        email: "academy.easysalesexport1@gmail.com",
        password: "@2025Easysales!",
        displayName: "Academy Admin",
        roles: ["general_user", "admin", "academy_admin"],
    },
    {
        email: "academyuser02@gmail.com",
        password: "@2025Easysales!",
        displayName: "Academy User 02",
        roles: ["general_user", "academy_member"],
    },
    // ── WAVE ──────────────────────────────────────────────────────────────────
    {
        email: "easysaleswave@gmail.com",
        password: "WAVE@2026",
        displayName: "WAVE Admin",
        roles: ["general_user", "admin", "wave_admin"],
    },
    {
        email: "waveuser02@gmail.com",
        password: "WAVE@2026",
        displayName: "WAVE User 02",
        roles: ["general_user", "wave_member"],
    },
    // ── Cooperative ───────────────────────────────────────────────────────────
    {
        email: "easysalescooperative@gmail.com",
        password: "Cooperative@2026.",
        displayName: "Cooperative Admin",
        roles: ["general_user", "admin", "cooperative_admin"],
    },
];

type Status = "exists_reset" | "created" | "error";
const results: { email: string; uid: string; status: Status; note?: string }[] = [];

async function processAccount(account: TestAccount) {
    const { email, password, displayName, roles } = account;
    let uid: string;
    let status: Status;

    try {
        // ── Auth ──────────────────────────────────────────────────────────────
        try {
            const existing = await adminAuth.getUserByEmail(email);
            uid = existing.uid;
            await adminAuth.updateUser(uid, {
                password,
                displayName,
                emailVerified: true,
                disabled: false,
            });
            status = "exists_reset";
        } catch (e: any) {
            if (e.code === "auth/user-not-found") {
                const rec = await adminAuth.createUser({
                    email,
                    password,
                    displayName,
                    emailVerified: true,
                });
                uid = rec.uid;
                status = "created";
            } else throw e;
        }

        // ── Firestore users/{uid} ─────────────────────────────────────────────
        const userRef = db.collection("users").doc(uid);
        const snap = await userRef.get();

        const nameParts = displayName.trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";

        if (!snap.exists) {
            await userRef.set({
                uid,
                fullName: displayName,
                firstName,
                lastName,
                email,
                phone: "",
                roles,
                isActive: true,
                emailVerified: true,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        } else {
            await userRef.update({
                roles,
                isActive: true,
                emailVerified: true,
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        results.push({ email, uid, status });
    } catch (e: any) {
        results.push({ email, uid: "—", status: "error", note: e.message });
    }
}

async function run() {
    console.log(`\nAuditing ${ACCOUNTS.length} accounts...\n`);

    for (const account of ACCOUNTS) {
        process.stdout.write(`  ${account.email} ... `);
        await processAccount(account);
        const r = results[results.length - 1];
        if (r.status === "exists_reset") console.log(`✅ EXISTS — password reset`);
        else if (r.status === "created")  console.log(`🆕 CREATED`);
        else                               console.log(`❌ ERROR: ${r.note}`);
    }

    console.log("\n──────────────────────────────────────────────────────────");
    console.log("SUMMARY");
    console.log("──────────────────────────────────────────────────────────");
    console.log(`  ✅ Reset:   ${results.filter(r => r.status === "exists_reset").length}`);
    console.log(`  🆕 Created: ${results.filter(r => r.status === "created").length}`);
    console.log(`  ❌ Errors:  ${results.filter(r => r.status === "error").length}`);

    const errors = results.filter(r => r.status === "error");
    if (errors.length) {
        console.log("\nFailed accounts:");
        errors.forEach(e => console.log(`  ${e.email}: ${e.note}`));
    }

    console.log("\nAll credentials:");
    ACCOUNTS.forEach(a => console.log(`  ${a.email.padEnd(45)} ${a.password}`));
    console.log("──────────────────────────────────────────────────────────\n");

    process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
