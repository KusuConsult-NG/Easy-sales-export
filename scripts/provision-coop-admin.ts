/**
 * provision-coop-admin.ts
 *
 * Grants the cooperative admin full admin rights:
 * - Firebase Auth custom claims: { cooperative_admin: true }
 * - Firestore users/ doc roles array: ["cooperative_admin"]
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/provision-coop-admin.ts
 */

import { db, adminAuth } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const COOP_ADMIN_EMAIL = "easysalescooperative@gmail.com";

async function main() {
    console.log(`\n🔧 Provisioning cooperative admin: ${COOP_ADMIN_EMAIL}\n`);

    // 1. Find the Firebase Auth user
    let authUser;
    try {
        authUser = await adminAuth.getUserByEmail(COOP_ADMIN_EMAIL);
        console.log(`✅ Auth user found: ${authUser.uid}`);
    } catch (e: any) {
        console.error(`❌ No Firebase Auth user for ${COOP_ADMIN_EMAIL}:`, e.message);
        process.exit(1);
    }

    // 2. Set custom claims on Firebase Auth
    await adminAuth.setCustomUserClaims(authUser.uid, {
        cooperative_admin: true,
        role: "cooperative_admin",
    });
    console.log(`✅ Custom claims set: { cooperative_admin: true }`);

    // 3. Find Firestore user doc (search by email OR by UID)
    let userDocRef = db.collection("users").doc(authUser.uid);
    let userDoc = await userDocRef.get();

    if (!userDoc.exists) {
        // Try searching by email
        const snap = await db.collection("users")
            .where("email", "==", COOP_ADMIN_EMAIL)
            .limit(1).get();
        if (!snap.empty) {
            userDocRef = snap.docs[0].ref;
            userDoc = snap.docs[0];
            console.log(`ℹ️  Found user doc by email (id: ${snap.docs[0].id})`);
        } else {
            console.log(`⚠️  No Firestore user doc found — creating one at users/${authUser.uid}`);
            await userDocRef.set({
                uid: authUser.uid,
                email: COOP_ADMIN_EMAIL,
                roles: ["cooperative_admin"],
                isAdmin: true,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
            console.log(`✅ Created new user doc at users/${authUser.uid}`);
            await printSummary(authUser.uid);
            return;
        }
    }

    // 4. Update existing user doc
    await userDocRef.update({
        roles: FieldValue.arrayUnion("cooperative_admin"),
        isAdmin: true,
        updatedAt: FieldValue.serverTimestamp(),
        _version: FieldValue.increment(1),
    });
    console.log(`✅ Firestore roles updated → added "cooperative_admin"`);

    // 5. Also update the admin_roles collection if it exists
    const adminRoleRef = db.collection("admin_roles").doc(authUser.uid);
    await adminRoleRef.set({
        uid: authUser.uid,
        email: COOP_ADMIN_EMAIL,
        role: "cooperative_admin",
        grantedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`✅ admin_roles doc upserted`);

    await printSummary(authUser.uid);
    process.exit(0);
}

async function printSummary(uid: string) {
    console.log("\n── Verification ─────────────────────────────────");
    
    const authUser = await adminAuth.getUser(uid);
    console.log("   Auth UID     :", uid);
    console.log("   Custom claims:", JSON.stringify(authUser.customClaims));

    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
        // Try by email
        const snap = await db.collection("users")
            .where("email", "==", COOP_ADMIN_EMAIL).limit(1).get();
        if (!snap.empty) {
            console.log("   Firestore roles:", JSON.stringify(snap.docs[0].data().roles));
        }
    } else {
        console.log("   Firestore roles:", JSON.stringify(userDoc.data()?.roles));
    }
    console.log("\n✅ Cooperative admin fully provisioned.\n");
    console.log("⚠️  The admin must SIGN OUT and SIGN BACK IN for the new role to take effect.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
