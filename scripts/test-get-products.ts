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

import { getMarketplaceProductsAction, getRecommendedProductsAction } from "../src/app/actions/marketplace";

async function main() {
    console.log("Calling getMarketplaceProductsAction...");
    const result = await getMarketplaceProductsAction({
        limit: 12,
        category: "all"
    });
    console.log("getMarketplaceProductsAction result success:", result.success);
    if (!result.success) {
        console.error("getMarketplaceProductsAction error:", result.error);
    } else {
        console.log(`Returned products count: ${result.data?.products?.length}`);
        result.data?.products?.forEach((p: any) => {
            console.log(`- ${p.id}: "${p.title}" (Status: ${p.status}, Category: ${p.category})`);
        });
    }

    console.log("\nCalling getRecommendedProductsAction...");
    const recResult = await getRecommendedProductsAction(3);
    console.log("getRecommendedProductsAction result success:", recResult.success);
    if (!recResult.success) {
        console.error("getRecommendedProductsAction error:", recResult.error);
    } else {
        console.log(`Returned recommended products count: ${recResult.data?.products?.length}`);
    }
}

main().catch(console.error);
