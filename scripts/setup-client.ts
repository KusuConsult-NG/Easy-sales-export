import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import * as dotenv from "dotenv";
import chalk from "chalk";

// Load environment variables
dotenv.config({ path: ".env.local" });

const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

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
        password: "password123",
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

async function seed() {
    console.log(chalk.blue.bold("\n🚀 Easy Sales SSO - Client-Side Seeder\n"));

    if (!config.apiKey) {
        console.error(chalk.red("❌ Missing API Key in .env.local"));
        process.exit(1);
    }

    const app = initializeApp(config);
    const auth = getAuth(app);
    const db = getFirestore(app);

    console.log(chalk.cyan("🌱 Seeding Users via Client SDK...\n"));

    for (const user of USERS_TO_SEED) {
        try {
            let uid;

            // 1. Try to Login First (to see if exists)
            try {
                const cred = await signInWithEmailAndPassword(auth, user.email, user.password);
                uid = cred.user.uid;
                console.log(chalk.gray(`   User ${user.email} already exists. Logging in...`));
            } catch (e: any) {
                if (e.code === 'auth/invalid-credential' || e.code === 'auth/user-not-found') {
                    // 2. Create User if not exists
                    try {
                        const newCred = await createUserWithEmailAndPassword(auth, user.email, user.password);
                        uid = newCred.user.uid;
                        console.log(chalk.green(`   Created user ${user.email} (UID: ${uid})`));
                    } catch (createError: any) {
                        if (createError.code === 'auth/email-already-in-use') {
                            console.log(chalk.yellow(`   User ${user.email} exists but password mismatch. Skipping...`));
                            continue;
                        }
                        throw createError;
                    }
                } else {
                    throw e;
                }
            }

            if (uid && auth.currentUser) {
                // 3. Update Profile (DisplayName)
                await updateProfile(auth.currentUser, {
                    displayName: `${user.firstName} ${user.lastName}`
                });

                // 4. Write Firestore Profile (Self-Write)
                await setDoc(doc(db, "users", uid), {
                    id: uid,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    fullName: `${user.firstName} ${user.lastName}`,
                    roles: user.roles,
                    role: user.roles[0], // Legacy
                    verified: true,
                    phoneNumber: user.phoneNumber,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    onboardingCompleted: true
                }, { merge: true });

                console.log(chalk.green(`   ✅ Synced Firestore profile for ${user.email}`));

                // 5. Sign Out to prepare for next user
                await signOut(auth);
            }

        } catch (error: any) {
            console.error(chalk.red(`   ❌ Failed to process ${user.email}:`), error.message);
        }
    }

    console.log(chalk.blue.bold("\n✨ Done! You can now login with these users."));
    process.exit(0);
}

seed();
