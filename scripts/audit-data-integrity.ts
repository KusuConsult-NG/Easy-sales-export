import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

// Initialize Firebase Admin
if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
    });
}

const db = getFirestore();

interface AuditStats {
    totalUsers: number;
    corruptedUsers: number;
    legacyVerified: number;
    missingNames: number;
    desyncedRegistrations: number;
    orphanedApplications: number;
    inconsistentTimestamps: number;
}

const COLLECTIONS = {
    USERS: "users",
    WAVE_APPLICATIONS: "wave_applications",
    ACADEMY_APPLICATIONS: "academy_applications",
    EXPORT_APPLICATIONS: "export_onboarding_applications",
    SELLER_VERIFICATIONS: "seller_verifications",
    COOPERATIVE_ONBOARDING: "cooperative_onboarding_applications",
};

async function auditDataIntegrity() {
    const stats: AuditStats = {
        totalUsers: 0,
        corruptedUsers: 0,
        legacyVerified: 0,
        missingNames: 0,
        desyncedRegistrations: 0,
        orphanedApplications: 0,
        inconsistentTimestamps: 0,
    };

    console.log("🔍 Starting Platform-Wide Data Integrity Audit...");
    console.log("=".repeat(60));

    try {
        // 1. Audit Users Collection
        const usersSnap = await db.collection(COLLECTIONS.USERS).get();
        stats.totalUsers = usersSnap.size;

        for (const userDoc of usersSnap.docs) {
            const data = userDoc.data();
            const userId = userDoc.id;
            let isUserCorrupted = false;

            // Check for missing names
            if (!data.firstName || !data.lastName) {
                stats.missingNames++;
                isUserCorrupted = true;
            }

            // Check for legacy verification field
            if (data.verified !== undefined && data.isVerified === undefined) {
                stats.legacyVerified++;
                isUserCorrupted = true;
            }

            // Check for missing serviceRegistrations
            if (!data.serviceRegistrations) {
                stats.desyncedRegistrations++;
                isUserCorrupted = true;
            }

            // Check timestamps
            if (!data.createdAt || !data.updatedAt) {
                stats.inconsistentTimestamps++;
                isUserCorrupted = true;
            }

            if (isUserCorrupted) stats.corruptedUsers++;
        }

        console.log(`✅ Users Audit Complete: ${stats.totalUsers} users scanned.`);

        // 2. Audit Cross-Module Synchronization
        console.log("\n📡 Auditing Cross-Module Registration Sync...");
        
        const moduleChecks = [
            { col: COLLECTIONS.WAVE_APPLICATIONS, key: "wave" },
            { col: COLLECTIONS.ACADEMY_APPLICATIONS, key: "academy" },
            { col: COLLECTIONS.EXPORT_APPLICATIONS, key: "export" },
            { col: COLLECTIONS.SELLER_VERIFICATIONS, key: "marketplace" },
            { col: COLLECTIONS.COOPERATIVE_ONBOARDING, key: "cooperatives" },
        ];

        for (const check of moduleChecks) {
            const appSnap = await db.collection(check.col).get();
            for (const appDoc of appSnap.docs) {
                const appData = appDoc.data();
                const userId = appData.userId;

                if (!userId) {
                    stats.orphanedApplications++;
                    continue;
                }

                const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                if (!userDoc.exists) {
                    stats.orphanedApplications++;
                    continue;
                }

                const userData = userDoc.data()!;
                const reg = userData.serviceRegistrations?.[check.key];

                if (!reg || reg.status !== appData.status) {
                    stats.desyncedRegistrations++;
                }
            }
        }

        // 3. Final Report
        console.log("\n" + "=".repeat(60));
        console.log("📊 FINAL INTEGRITY REPORT");
        console.log("=".repeat(60));
        console.log(`Total Users Processed:   ${stats.totalUsers}`);
        console.log(`Corrupted User Profiles: ${stats.corruptedUsers}`);
        console.log(`Legacy Schema Fields:    ${stats.legacyVerified}`);
        console.log(`Missing Name Fields:     ${stats.missingNames}`);
        console.log(`Desynced Registrations:  ${stats.desyncedRegistrations}`);
        console.log(`Orphaned Applications:   ${stats.orphanedApplications}`);
        console.log(`Timestamp Issues:        ${stats.inconsistentTimestamps}`);
        console.log("=".repeat(60));

        if (stats.corruptedUsers > 0 || stats.desyncedRegistrations > 0) {
            console.log("\n⚠️  ACTION REQUIRED: Data integrity issues detected.");
            console.log("Run 'npm run recovery:data' to apply fixes.");
        } else {
            console.log("\n✨ SUCCESS: Platform data integrity is within high-assurance parameters.");
        }

    } catch (error) {
        console.error("\n❌ Audit failed:", error);
        process.exit(1);
    }
}

auditDataIntegrity().then(() => process.exit(0));
