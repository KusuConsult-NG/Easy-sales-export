import fs from 'fs';
import path from 'path';

// Load .env.production.local manually
try {
    const envPath = path.resolve(__dirname, '../.env.production.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }
                value = value.replace(/\\n/g, '\n');
                process.env[key] = value;
            }
        });
        console.log("Loaded .env.production.local successfully.");
    }
} catch (e) {
    console.error("Failed to load environment:", e);
}

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("--- INSPECTING MARKETPLACE PRODUCTS ---");
    const productsSnap = await db.collection("products").get();
    console.log(`Total documents in 'products' collection: ${productsSnap.size}`);
    
    const productsStatusMap: Record<string, number> = {};
    productsSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "no_status";
        productsStatusMap[status] = (productsStatusMap[status] || 0) + 1;
        console.log(`- Product ID: ${doc.id} | Title: "${data.title}" | Status: "${status}" | Category: "${data.category}"`);
    });
    console.log("Products Status Summary:", productsStatusMap);

    console.log("\n--- INSPECTING LAND LISTINGS (FARM NATION) ---");
    const landSnap = await db.collection("land_listings").get();
    console.log(`Total documents in 'land_listings' collection: ${landSnap.size}`);
    
    const landStatusMap: Record<string, number> = {};
    landSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.status || "no_status";
        const verificationStatus = data.verificationStatus || data.verification?.status || "no_verification_status";
        landStatusMap[status] = (landStatusMap[status] || 0) + 1;
        console.log(`- Land ID: ${doc.id} | Title: "${data.title}" | Status: "${status}" | VerificationStatus: "${verificationStatus}"`);
    });
    console.log("Land Listings Status Summary:", landStatusMap);
}

main().catch(console.error);
