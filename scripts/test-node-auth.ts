import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
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

async function testNodeLogin() {
    console.log(chalk.blue.bold("\n🧪 Testing Firebase Login in Node.js Environment\n"));

    if (!config.apiKey) {
        console.error(chalk.red("❌ Missing API Key"));
        process.exit(1);
    }

    try {
        const app = initializeApp(config);
        const auth = getAuth(app);

        console.log(chalk.yellow("   Attempting to sign in 'admin@easysales.com'..."));

        const cred = await signInWithEmailAndPassword(auth, "admin@easysales.com", "password123");
        console.log(chalk.green(`✅ Success! Logged in as: ${cred.user.email} (${cred.user.uid})`));

        const token = await cred.user.getIdToken();
        console.log(chalk.green(`✅ ID Token Generated (Length: 960)`));

        // Test Firestore Read (Mimic auth.ts)
        console.log(chalk.yellow("\n   Attempting to read user profile from Firestore (Client SDK)..."));
        const { getFirestore, doc, getDoc } = await import("firebase/firestore");
        const db = getFirestore(app);

        try {
            const userDoc = await getDoc(doc(db, "users", cred.user.uid));
            if (userDoc.exists()) {
                console.log(chalk.green(`✅ Profile Found: ${JSON.stringify(userDoc.data(), null, 2)}`));
            } else {
                console.log(chalk.red("❌ Profile NOT Found (getDoc returned exists=false)"));
            }
        } catch (fsError: any) {
            console.error(chalk.red(`❌ Firestore Read Failed: ${fsError.message}`));
            console.error(chalk.red(`   Code: ${fsError.code}`));
        }

    } catch (error: any) {
        console.error(chalk.red("\n❌ Login Failed:"));
        console.error(chalk.red(`   Code: ${error.code}`));
        console.error(chalk.red(`   Message: ${error.message}`));
    }
}

testNodeLogin();
