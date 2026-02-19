import { initializeApp, cert } from "firebase-admin/app";
import { GoogleAuth } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";

async function addLocalhost() {
    console.log(chalk.blue.bold("\n🌐 Automating Firebase Authorized Domains Configuration\n"));

    const keyPath = path.resolve(process.cwd(), "service-account.json");
    if (!fs.existsSync(keyPath)) {
        console.error(chalk.red("❌ service-account.json not found"));
        process.exit(1);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    const projectId = serviceAccount.project_id;

    console.log(chalk.cyan(`🔹 Project: ${projectId}`));

    try {
        // 1. Get Access Token
        const auth = new GoogleAuth({
            keyFile: keyPath,
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

        // 3. Check and Add Localhost
        if (currentDomains.includes("localhost")) {
            console.log(chalk.green("\n✅ 'localhost' is ALREADY authorized!"));
            return;
        }

        console.log(chalk.yellow("\n   Adding 'localhost' to authorized domains..."));
        const newDomains = [...currentDomains, "localhost"];

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

        console.log(chalk.green("\n🎉 Success! Added 'localhost' to Authorized Domains."));
        console.log(chalk.green("   You should now be able to login without 'Network Request Failed' errors."));

    } catch (error: any) {
        console.error(chalk.red("\n❌ Failed to update configuration automatically:"));
        console.error(chalk.red(error.message));
        console.log(chalk.yellow("\nFallback: Please follow the manual instructions provided earlier."));
    }
}

addLocalhost();
