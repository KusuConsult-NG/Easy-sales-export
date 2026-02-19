import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import * as dotenv from "dotenv";
import chalk from "chalk";

// Load environment variables
dotenv.config({ path: ".env.local" });

async function diagnose() {
    console.log(chalk.blue.bold("\n🔍 Firebase Diagnostics Tool\n"));

    const config = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    };

    console.log(chalk.yellow("Configuration Loaded:"));
    console.log(`- API Key: ${config.apiKey ? "✅ Present (" + config.apiKey.substring(0, 4) + "...)" : "❌ MISSING"}`);
    console.log(`- Auth Domain: ${config.authDomain || "❌ MISSING"}`);
    console.log(`- Project ID: ${config.projectId || "❌ MISSING"}`);

    if (!config.apiKey || !config.authDomain) {
        console.error(chalk.red("\n❌ Missing critical configuration. Check .env.local"));
        process.exit(1);
    }

    try {
        console.log(chalk.cyan("\n1. Initializing Firebase App..."));
        const app = initializeApp(config);
        const auth = getAuth(app);
        console.log(chalk.green("✅ App Initialized"));

        console.log(chalk.cyan("\n2. Testing Connectivity (Anonymous Auth)..."));
        console.log(chalk.gray("   Attempting to reach Firebase Auth servers..."));

        const userCredential = await signInAnonymously(auth);
        console.log(chalk.green(`✅ Connection Successful! User UID: ${userCredential.user.uid}`));
        console.log(chalk.green("\n🎉 NETWORK STATUS: OK (Server-side)"));
        console.log(chalk.gray("   If this works but the browser fails, the issue is likely:"));
        console.log(chalk.gray("   - 'localhost' not in Authorized Domains (Firebase Console)"));
        console.log(chalk.gray("   - Browser Extension blocking requests"));
        console.log(chalk.gray("   - CORS policy on API Key"));

    } catch (error: any) {
        console.error(chalk.red("\n❌ Connection Failed:"), error.message);
        console.error(chalk.red("   Error Code:"), error.code);

        if (error.code === 'auth/network-request-failed') {
            console.log(chalk.yellow("\n💡 Troubleshooting Tips:"));
            console.log("   - Check your internet connection (DNS/Proxy)");
            console.log("   - Verify API Key is not restricted to specific IP/Referrer");
            console.log("   - Check if firewall is blocking googleapis.com");
        }
        process.exit(1);
    }
}

diagnose();
