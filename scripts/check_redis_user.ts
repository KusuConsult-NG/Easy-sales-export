import * as fs from "fs";
import { getCached, CacheKeys } from "../src/lib/redis";

function loadEnv(filePath: string) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    content.split("\n").forEach(line => {
        const parts = line.split("=");
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let val = parts.slice(1).join("=").trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
            if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
            process.env[key] = val;
        }
    });
}

loadEnv(".env.local");

async function main() {
    const userId = "G7tQGmdl1ThZPsybhjcpnKrIlwB2";
    const cacheKey = CacheKeys.userProfile(userId);
    console.log(`Fetching Redis cache key: ${cacheKey}`);
    try {
        const cachedData = await getCached(cacheKey);
        console.log("Cached User Data:", JSON.stringify(cachedData, null, 2));
    } catch (err) {
        console.error("Redis fetch failed:", err);
    }
}

main().catch(console.error);
