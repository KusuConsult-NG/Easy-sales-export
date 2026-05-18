import { adminAuth, db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

interface AdminConfig {
    email: string;
    password: string;
    displayName: string;
    roles: string[];
}

const ADMIN_ACCOUNTS: AdminConfig[] = [
    {
        email: "admin@easysalesexport.com",
        password: "Admin@2026",
        displayName: "Super Admin",
        roles: [
            "super_admin",
            "admin",
            "moderator",
            "support",
            "wave_admin",
            "cooperative_admin",
            "marketplace_admin",
            "export_admin",
            "farmnation_admin",
            "academy_admin",
            "admin_dashboard_access"
        ]
    },
    {
        email: "admin.easysalesexport@gmail.com",
        password: "Admin@2026",
        displayName: "System Admin",
        roles: [
            "super_admin",
            "admin",
            "moderator",
            "support",
            "wave_admin",
            "cooperative_admin",
            "marketplace_admin",
            "export_admin",
            "farmnation_admin",
            "academy_admin",
            "admin_dashboard_access"
        ]
    },
    {
        email: "qa_audit_admin@easysalesexport.com",
        password: "QA_Password_123!!",
        displayName: "QA System Auditor",
        roles: [
            "super_admin",
            "admin",
            "moderator",
            "support",
            "wave_admin",
            "cooperative_admin",
            "marketplace_admin",
            "export_admin",
            "farmnation_admin",
            "academy_admin",
            "admin_dashboard_access"
        ]
    }
];

async function fixAllAdmins() {
    console.log("Starting master administrative accounts restoration & role synchronization...\n");

    for (const config of ADMIN_ACCOUNTS) {
        console.log(`Processing: ${config.email}`);
        let uid = "";
        
        // 1. Firebase Auth Setup/Reset
        try {
            const userRecord = await adminAuth.getUserByEmail(config.email);
            uid = userRecord.uid;
            console.log(`  - Account exists in Firebase Auth (UID: ${uid}). Resetting password and active state...`);
            await adminAuth.updateUser(uid, {
                password: config.password,
                displayName: config.displayName,
                emailVerified: true,
                disabled: false
            });
        } catch (e: any) {
            if (e.code === "auth/user-not-found") {
                console.log("  - Account NOT found in Firebase Auth. Creating new user...");
                const userRecord = await adminAuth.createUser({
                    email: config.email,
                    password: config.password,
                    displayName: config.displayName,
                    emailVerified: true
                });
                uid = userRecord.uid;
                console.log(`  - Successfully created in Firebase Auth (UID: ${uid})`);
            } else {
                console.error(`  - Failed to process Auth for ${config.email}: ${e.message}`);
                continue;
            }
        }

        // 2. Set Custom User Claims for NextAuth custom authorization guards
        try {
            console.log("  - Setting Custom Claims in Firebase Auth (admin: true)...");
            await adminAuth.setCustomUserClaims(uid, {
                admin: true,
                roles: config.roles
            });
        } catch (claimsErr: any) {
            console.error(`  - Failed to set custom claims: ${claimsErr.message}`);
        }

        // 3. Firestore Document Creation/Update
        try {
            console.log("  - Synchronizing user profile doc in Firestore...");
            const nameParts = config.displayName.trim().split(/\s+/);
            const firstName = nameParts[0] || "";
            const lastName = nameParts.slice(1).join(" ") || "";

            const userRef = db.collection("users").doc(uid);
            const snap = await userRef.get();

            const docData = {
                uid,
                email: config.email,
                fullName: config.displayName,
                firstName,
                lastName,
                roles: config.roles,
                isActive: true,
                status: "active",
                emailVerified: true,
                verified: true,
                updatedAt: FieldValue.serverTimestamp()
            };

            if (!snap.exists) {
                await userRef.set({
                    ...docData,
                    createdAt: FieldValue.serverTimestamp()
                });
                console.log("  - Created new Firestore user profile document.");
            } else {
                await userRef.update(docData);
                console.log("  - Updated existing Firestore user profile document.");
            }
        } catch (fsErr: any) {
            console.error(`  - Failed to sync Firestore: ${fsErr.message}`);
        }

        // 4. Redis Cache Invalidation
        try {
            console.log("  - Invalidating user Redis cache...");
            const { redis, CacheKeys } = await import("../src/lib/redis");
            await Promise.all([
                redis.del(CacheKeys.userProfile(uid)),
                redis.del(CacheKeys.userPermissions(uid)),
                redis.del(CacheKeys.userSession(uid)),
                redis.del(CacheKeys.userStats(uid)),
            ]);
            console.log("  - Cache invalidated successfully.");
        } catch (cacheErr: any) {
            console.warn(`  - Cache invalidation skipped/failed: ${cacheErr.message}`);
        }

        console.log(`Finished processing: ${config.email}\n`);
    }

    console.log("Master administrative accounts setup complete!");
    process.exit(0);
}

fixAllAdmins().catch(err => {
    console.error("Fatal Seeding Error:", err);
    process.exit(1);
});
