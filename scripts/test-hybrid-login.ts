import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { initializeApp as initAdmin, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
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

async function testHybridLogin() {
    console.log(chalk.blue.bold("\n🧪 Testing Hybrid Login (Client Auth + Admin Data)\n"));

    // 1. Initialize Client SDK (for Auth)
    const clientApp = initializeApp(config, "CLIENT_APP");
    const clientAuth = getAuth(clientApp);

    // 2. Initialize Admin SDK (for Data)
    const serviceAccount = JSON.parse(fs.readFileSync(path.resolve("service-account.json"), "utf-8"));
    const adminApp = initAdmin({
        credential: cert(serviceAccount)
    }, "ADMIN_APP");
    const adminDb = getFirestore(adminApp);

    try {
        // 3. Login with Client SDK
        console.log(chalk.yellow("   🔐 Authenticating with Client SDK..."));
        const cred = await signInWithEmailAndPassword(clientAuth, "admin@easysales.com", "password123");
        console.log(chalk.green(`   ✅ Logged in as: ${cred.user.email} (${cred.user.uid})`));

        // 4. Fetch Profile with Admin SDK
        console.log(chalk.yellow("\n   📂 Fetching Profile with Admin SDK..."));
        const userDoc = await adminDb.collection("users").doc(cred.user.uid).get();

        if (userDoc.exists) {
            console.log(chalk.green(`   ✅ Profile Found!`));
            console.log(chalk.gray(JSON.stringify(userDoc.data(), null, 2)));
        } else {
            console.log(chalk.red("   ❌ Profile NOT Found (but it should be!)"));
        }

    } catch (error: any) {
        console.error(chalk.red("\n❌ Test Failed:"));
        console.error(chalk.red(`   Message: ${error.message}`));
    }
}

testHybridLogin();
