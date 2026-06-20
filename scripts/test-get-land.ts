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

// Next.js cache requires mocking some APIs if executed outside Next context
// let's see if we can call it directly.
import { searchLandListingsAction } from "../src/app/actions/land-listings";

async function main() {
    console.log("Calling searchLandListingsAction...");
    const result = await searchLandListingsAction({ limit: 50 });
    console.log("searchLandListingsAction result success:", result.success);
    if (!result.success) {
        console.error("searchLandListingsAction error:", result.error);
    } else {
        console.log(`Returned listings count: ${result.data?.listings?.length}`);
        result.data?.listings?.forEach((l: any) => {
            console.log(`- ${l.id}: "${l.title}" (Status: ${l.status}, State: ${l.location?.state || l.location})`);
        });
    }
}

main().catch(console.error);
