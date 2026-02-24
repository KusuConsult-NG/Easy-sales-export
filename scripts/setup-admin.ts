import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";
import chalk from "chalk";

// Load environment variables
dotenv.config({ path: ".env.local" });

// Define roles locally to avoid build/import issues in script
type UserRole =
    | "general_user"
    | "buyer"
    | "seller"
    | "land_owner"
    | "farmer"
    | "investor"
    | "export_participant"
    | "cooperative_member"
    | "wave_participant"
    | "academy_participant"
    | "field_officer"
    | "admin"
    | "super_admin";

const USERS_TO_SEED = [
    {
        email: "admin@easysales.com",
        password: "password123", // Change in production
        firstName: "System",
        lastName: "Administrator",
        roles: ["super_admin", "admin"] as UserRole[],
        phoneNumber: "+2348000000000"
    },
    {
        email: "seller@easysales.com",
        password: "password123",
        firstName: "Test",
        lastName: "Seller",
        roles: ["seller", "general_user"] as UserRole[],
        phoneNumber: "+2348000000001"
    },
    {
        email: "buyer@easysales.com",
        password: "password123",
        firstName: "Test",
        lastName: "Buyer",
        roles: ["buyer", "general_user"] as UserRole[],
        phoneNumber: "+2348000000002"
    },
    {
        email: "farmer@easysales.com",
        password: "password123",
        firstName: "Farm",
        lastName: "Owner",
        roles: ["farmer", "land_owner"] as UserRole[],
        phoneNumber: "+2348000000003"
    },
    {
        email: "academy@easysales.com",
        password: "password123",
        firstName: "Academy",
        lastName: "Student",
        roles: ["academy_participant"] as UserRole[],
        phoneNumber: "+2348000000004"
    },
    {
        email: "wave@easysales.com",
        password: "password123",
        firstName: "Wave",
        lastName: "Participant",
        roles: ["wave_participant"] as UserRole[],
        phoneNumber: "+2348000000005"
    }
];

async function main() {
    console.log(chalk.blue.bold("\n🚀 Easy Sales SSO - Admin Setup & Repair Script\n"));

    // 1. Initialize Firebase Admin
    let serviceAccount;
    const keyPath = path.resolve(process.cwd(), "service-account.json");

    if (fs.existsSync(keyPath)) {
        serviceAccount = require(keyPath);
        console.log(chalk.green(`✅ Found service account key at ${keyPath}`));
    } else {
        console.log(chalk.yellow("⚠️  No 'service-account.json' found in apps/hub root."));
        console.log(chalk.yellow("   Please download a new private key from Firebase Console -> Project Settings -> Service Accounts"));
        console.log(chalk.yellow("   and save it as 'service-account.json' in apps/hub.\n"));
        process.exit(1);
    }

    if (getApps().length === 0) {
        initializeApp({
            credential: cert(serviceAccount)
        });
    }

    const auth = getAuth();
    const db = getFirestore();

    // 2. Auto-Execute Seed & Repair
    console.log(chalk.cyan("\n🤖 Auto-Executing Seeding & Repair..."));

    // Default action: Seed
    const action = "seed";

    if (action === "seed") {
        console.log(chalk.cyan("\n🌱 Seeding Default Users..."));

        for (const user of USERS_TO_SEED) {
            try {
                // Check if user exists
                let uid;
                try {
                    const existingUser = await auth.getUserByEmail(user.email);
                    uid = existingUser.uid;
                    console.log(chalk.gray(`   User ${user.email} already exists (UID: ${uid}). Updating...`));

                    // Update password if needed (optional)
                    await auth.updateUser(uid, {
                        emailVerified: true,
                        displayName: `${user.firstName} ${user.lastName}`
                    });
                } catch (e: any) {
                    if (e.code === 'auth/user-not-found') {
                        // Create new user
                        const newUser = await auth.createUser({
                            email: user.email,
                            password: user.password,
                            emailVerified: true,
                            displayName: `${user.firstName} ${user.lastName}`,
                            phoneNumber: user.phoneNumber
                        });
                        uid = newUser.uid;
                        console.log(chalk.green(`   Created user ${user.email} (UID: ${uid})`));
                    } else {
                        throw e;
                    }
                }

                // Create/Update Firestore Profile
                if (uid) {
                    await db.collection("users").doc(uid).set({
                        id: uid,
                        email: user.email,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        roles: user.roles, // Ensure array format
                        role: user.roles[0], // Legacy backward compatibility
                        verified: true,
                        phoneNumber: user.phoneNumber,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        onboardingCompleted: true
                    }, { merge: true });

                    console.log(chalk.green(`   ✅ Synced Firestore profile for ${user.email}`));
                }

            } catch (error) {
                console.error(chalk.red(`   ❌ Failed to process ${user.email}:`), error);
            }
        }
    }

    if ((action as string) === "repair") {
        console.log(chalk.cyan("\n🔧 Repairing Existing Users..."));

        const usersSnapshot = await db.collection("users").get();
        let updatedCount = 0;

        for (const doc of usersSnapshot.docs) {
            const data = doc.data();
            const updates: any = {};
            let needsUpdate = false;

            // 1. Fix Missing ID
            if (!data.id) {
                updates.id = doc.id;
                needsUpdate = true;
            }

            // 2. Migrate Legacy Role -> Roles Array
            if (!data.roles && data.role) {
                updates.roles = [data.role];
                needsUpdate = true;
                console.log(chalk.yellow(`   Migrating ${doc.id}: role string -> roles array`));
            } else if (!data.roles && !data.role) {
                updates.roles = ["general_user"];
                updates.role = "general_user";
                needsUpdate = true;
            }

            // 3. Ensure Verified Field
            if (typeof data.verified === 'undefined') {
                updates.verified = false; // Default to false if unknown
                needsUpdate = true;
            }

            if (needsUpdate) {
                await doc.ref.update(updates);
                updatedCount++;
            }
        }

        console.log(chalk.green(`\n✅ Repaired ${updatedCount} user profiles.`));
    }

    console.log(chalk.blue.bold("\n✨ Done!"));
    process.exit(0);
}

main().catch((error) => {
    console.error(chalk.red("Fatal Error:"), error);
    process.exit(1);
});
