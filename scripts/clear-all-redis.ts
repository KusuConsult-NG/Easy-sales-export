/**
 * Utility script to clear all user-related cache keys from Upstash Redis.
 * Run: NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local npx ts-node --compiler-options '{"module":"commonjs"}' scripts/clear-all-redis.ts
 */
import { redis } from "../src/lib/redis";

async function run() {
    console.log("Fetching all user cache keys from Redis...");
    try {
        const keys = await redis.keys("user:*");
        console.log(`Found ${keys.length} keys matching 'user:*'`);
        
        if (keys.length > 0) {
            const deleted = await redis.del(...keys);
            console.log(`Successfully deleted ${deleted} keys from Redis.`);
        } else {
            console.log("No keys found to delete.");
        }
    } catch (error: any) {
        console.error("Failed to clear Redis cache:", error.message);
    }
    process.exit(0);
}

run();
