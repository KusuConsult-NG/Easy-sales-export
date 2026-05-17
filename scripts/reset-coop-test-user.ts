/**
 * Creates/resets cooperative test user in Firebase Auth + Firestore.
 * Run: npx ts-node --skip-project scripts/reset-coop-test-user.ts
 */
import { adminAuth, db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

const EMAIL = "cooperativeuser02@gmail.com";
const PASSWORD = "Cooperative@2026.";
const DISPLAY_NAME = "Cooperative User 02";

async function run() {
    let uid: string;

    // ── 1. Firebase Auth ──────────────────────────────────────────────────────
    try {
        const existing = await adminAuth.getUserByEmail(EMAIL);
        console.log(`✅ Auth user already exists: ${existing.uid}`);
        await adminAuth.updateUser(existing.uid, {
            password: PASSWORD,
            emailVerified: true,
            disabled: false,
        });
        console.log("✅ Password reset + account enabled");
        uid = existing.uid;
    } catch (e: any) {
        if (e.code === "auth/user-not-found") {
            console.log("⚠️  Not in Auth — creating...");
            const rec = await adminAuth.createUser({
                email: EMAIL,
                password: PASSWORD,
                displayName: DISPLAY_NAME,
                emailVerified: true,
            });
            uid = rec.uid;
            console.log("✅ Auth user created:", uid);
        } else {
            throw e;
        }
    }

    // ── 2. Firestore users/{uid} profile ─────────────────────────────────────
    const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
    const snap = await userRef.get();

    if (!snap.exists) {
        await userRef.set({
            uid,
            fullName: DISPLAY_NAME,
            firstName: "Cooperative",
            lastName: "User 02",
            email: EMAIL,
            phone: "",
            roles: ["general_user", "cooperative_member"],
            isActive: true,
            emailVerified: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        console.log("✅ Firestore user profile created");
    } else {
        // Ensure roles and active flag are correct for existing records
        await userRef.update({
            roles: ["general_user", "cooperative_member"],
            isActive: true,
            emailVerified: true,
            updatedAt: FieldValue.serverTimestamp(),
        });
        console.log("✅ Firestore profile updated (roles + active)");
    }

    console.log("\n──────────────────────────────────────────");
    console.log("Login credentials ready:");
    console.log("  Email:   ", EMAIL);
    console.log("  Password:", PASSWORD);
    console.log("──────────────────────────────────────────");
    process.exit(0);
}

run().catch((e) => {
    console.error("❌ Error:", e.message || e);
    process.exit(1);
});
