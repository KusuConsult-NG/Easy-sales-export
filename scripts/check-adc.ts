import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import chalk from "chalk";

async function checkADC() {
    console.log(chalk.blue.bold("\n🕵️ Checking Application Default Credentials (ADC)...\n"));

    try {
        // Attempt to initialize with default credentials
        // This looks for GOOGLE_APPLICATION_CREDENTIALS env var
        // OR gcloud auth application-default login credentials
        initializeApp({
            credential: applicationDefault(),
            projectId: "easy-sales-hub" // We know this from .env
        });

        console.log(chalk.green("✅ Admin SDK initialized with Default Credentials!"));

        const auth = getAuth();
        try {
            const user = await auth.getUserByEmail("admin@easysales.com");
            console.log(chalk.green(`✅ Proven Access! Found user: ${user.uid}`));
            console.log(chalk.green("\n🎉 WE CAN RUN THE SETUP SCRIPT WITHOUT A KEY!"));
        } catch (e: any) {
            console.log(chalk.yellow(`⚠️  Initialized, but failed to fetch user: ${e.message}`));
            if (e.code === 'auth/user-not-found') {
                console.log(chalk.green("✅ (User doesn't exist, but connection worked)"));
            } else {
                console.log(chalk.red("❌ Credentials likely invalid or insufficient permissions."));
            }
        }

    } catch (error: any) {
        console.error(chalk.red("\n❌ ADC Check Failed:"), error.message);
        console.log(chalk.gray("   This means no 'gcloud' or 'firebase' login credentials are active on this system."));
    }
}

checkADC();
