import { Redis } from "@upstash/redis";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function clearCache(userId: string) {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!redisUrl || !redisToken) {
        console.error("UPSTASH_REDIS env vars not found");
        return;
    }

    const redis = new Redis({ url: redisUrl, token: redisToken });
    
    const keys = [
        `user:profile:${userId}`,
        `user:permissions:${userId}`,
        `user:session:${userId}`,
        `user:stats:${userId}`,
        `seller:status:${userId}`
    ];
    
    for (const key of keys) {
        await redis.del(key);
        console.log(`Deleted Redis key: ${key}`);
    }
    
    console.log("Redis cache cleared.");
}

const userId = "W9VJZdkpxQRSvU8tSlJvMwwibTW2";
clearCache(userId);
