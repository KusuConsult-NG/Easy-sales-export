import { initializeApp, cert } from "firebase-admin/app";
import { GoogleAuth } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import dotenv from "dotenv";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const NEW_DOMAINS = [
    "localhost",
    "easysalesexport.com",
    "easysalescooperative.com",
    "easysalesexportacademy.com",
    "easysalesmarket.com",
    "waveprogramme.gov.ng",
    "farmnation.ng",
    "easysalesexportng.com"
];

async function addDomains() {
    console.log(chalk.blue.bold("\n🌐 Automating Firebase Authorized Domains Configuration\n"));

    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
        console.error(chalk.red("❌ Firebase credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) not found in .env.local"));
        process.exit(1);
    }

    console.log(chalk.cyan(`🔹 Project: ${projectId}`));

    try {
        // 1. Get Access Token
        const auth = new GoogleAuth({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey
            },
            scopes: ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/firebase"]
        });
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();

        // 2. Get Current Config
        // Identity Toolkit API v2
        const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;

        console.log(chalk.yellow("   Fetching current configuration..."));
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken.token}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch config: ${response.status} ${response.statusText} - ${await response.text()}`);
        }

        const config = await response.json();
        const currentDomains = config.authorizedDomains || [];

        console.log(chalk.gray(`   Current Domains: ${currentDomains.join(", ")}`));

        // 3. Check and Add Domains
        const missingDomains = NEW_DOMAINS.filter(domain => !currentDomains.includes(domain));

        if (missingDomains.length === 0) {
            console.log(chalk.green("\n✅ All target domains are ALREADY authorized!"));
            return;
        }

        console.log(chalk.yellow(`\n   Adding ${missingDomains.length} domains to authorized domains (${missingDomains.join(", ")})...`));
        const newDomains = [...currentDomains, ...missingDomains];

        // 4. Update Config
        const updateUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=authorizedDomains`;
        const updateResponse = await fetch(updateUrl, {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${accessToken.token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                authorizedDomains: newDomains
            })
        });

        if (!updateResponse.ok) {
            throw new Error(`Failed to update config: ${updateResponse.status} ${updateResponse.statusText} - ${await updateResponse.text()}`);
        }

        console.log(chalk.green(`\n🎉 Success! Added new domains: ${missingDomains.join(", ")}`));
        console.log(chalk.green("   You should now be able to login across all 7 platforms without 'Network Request Failed' errors."));

    } catch (error: any) {
        console.error(chalk.red("\n❌ Failed to update configuration automatically:"));
        console.error(chalk.red(error.message));
        console.log(chalk.yellow("\nFallback: Please follow the manual instructions provided earlier."));
    }
}

addDomains();
