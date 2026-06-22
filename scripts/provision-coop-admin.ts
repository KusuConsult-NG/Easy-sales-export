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

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db, adminAuth } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const COOP_ADMIN_EMAIL = "easysalescooperative@gmail.com";
const COOP_ADMIN_PASSWORD = "coopAdmin2026";
const COOP_ADMIN_UID = "fiIid9Vl9YXXLCpjDN0UqvtfBWh2";

async function main() {
    console.log(`\n🔧 Provisioning cooperative admin: ${COOP_ADMIN_EMAIL}\n`);

    // 1. Find or create the Firebase Auth user
    let authUser;
    try {
        authUser = await adminAuth.getUserByEmail(COOP_ADMIN_EMAIL);
        console.log(`✅ Auth user found by email: ${authUser.uid}`);
        await adminAuth.updateUser(authUser.uid, {
            password: COOP_ADMIN_PASSWORD,
            displayName: "Cooperative Admin",
            emailVerified: true,
            disabled: false,
        });
        console.log(`✅ Auth password updated/reset`);
    } catch (e: any) {
        if (e.code === "auth/user-not-found") {
            console.log(`⚠️ User not found in Auth by email. Let's see if the UID exists...`);
            try {
                // Try updating the UID directly
                await adminAuth.updateUser(COOP_ADMIN_UID, {
                    email: COOP_ADMIN_EMAIL,
                    password: COOP_ADMIN_PASSWORD,
                    displayName: "Cooperative Admin",
                    emailVerified: true,
                    disabled: false,
                });
                authUser = await adminAuth.getUser(COOP_ADMIN_UID);
                console.log(`✅ Updated existing Auth user by UID ${COOP_ADMIN_UID} to email/password`);
            } catch (uidErr: any) {
                if (uidErr.code === "auth/user-not-found") {
                    console.log(`⚠️ UID not found either. Creating new user with UID ${COOP_ADMIN_UID}...`);
                    authUser = await adminAuth.createUser({
                        uid: COOP_ADMIN_UID,
                        email: COOP_ADMIN_EMAIL,
                        password: COOP_ADMIN_PASSWORD,
                        displayName: "Cooperative Admin",
                        emailVerified: true,
                    });
                    console.log(`✅ Created user in Auth with UID: ${authUser.uid}`);
                } else {
                    console.error(`❌ Firebase Auth error by UID:`, uidErr.message);
                    process.exit(1);
                }
            }
        } else {
            console.error(`❌ Firebase Auth error:`, e.message);
            process.exit(1);
        }
    }

    const uid = authUser.uid;

    // 2. Set custom claims on Firebase Auth
    const roles = ["cooperative_admin", "admin"];
    await adminAuth.setCustomUserClaims(uid, {
        admin: true,
        cooperative_admin: true,
        role: "cooperative_admin",
        roles,
    });
    console.log(`✅ Custom claims set: { admin: true, cooperative_admin: true, roles: [${roles.join(", ")}] }`);

    // 3. Find/Update Firestore user doc
    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    const payload = {
        uid: uid,
        email: COOP_ADMIN_EMAIL,
        roles: roles,
        isAdmin: true,
        isActive: true,
        status: "active",
        emailVerified: true,
        verified: true,
        isVerified: true,
        fullName: "Cooperative Admin",
        firstName: "Cooperative",
        lastName: "Admin",
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (!userDoc.exists) {
        console.log(`⚠️ No Firestore user doc found — creating one at users/${uid}`);
        await userDocRef.set({
            ...payload,
            createdAt: FieldValue.serverTimestamp(),
        });
        console.log(`✅ Created new user doc in Firestore`);
    } else {
        await userDocRef.update({
            ...payload,
            _version: FieldValue.increment(1),
        });
        console.log(`✅ Updated existing user doc in Firestore`);
    }

    // 4. Update the admin_roles collection
    const adminRoleRef = db.collection("admin_roles").doc(uid);
    await adminRoleRef.set({
        uid: uid,
        email: COOP_ADMIN_EMAIL,
        role: "cooperative_admin",
        roles: roles,
        grantedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`✅ admin_roles doc upserted`);

    // 5. Invalidate Redis cache
    try {
        const { redis, CacheKeys } = await import("../src/lib/redis");
        await Promise.all([
            redis.del(CacheKeys.userProfile(uid)),
            redis.del(CacheKeys.userPermissions(uid)),
            redis.del(CacheKeys.userSession(uid)),
            redis.del(CacheKeys.userStats(uid)),
        ]);
        console.log(`✅ Redis: all cache keys deleted`);
    } catch (cacheErr: any) {
        console.warn(`⚠️ Redis invalidation warning: ${cacheErr.message}`);
    }

    await printSummary(uid);
    process.exit(0);
}

async function printSummary(uid: string) {
    console.log("\n── Verification ─────────────────────────────────");
    
    const authUser = await adminAuth.getUser(uid);
    console.log("   Auth UID     :", uid);
    console.log("   Custom claims:", JSON.stringify(authUser.customClaims));

    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists) {
        console.log("   Firestore roles:", JSON.stringify(userDoc.data()?.roles));
    } else {
        console.log("   Firestore doc not found!");
    }
    console.log("\n✅ Cooperative admin fully provisioned.\n");
    console.log("⚠️  The admin must SIGN OUT and SIGN BACK IN for the new role to take effect.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
