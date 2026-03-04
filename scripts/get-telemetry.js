require('dotenv').config({ path: '.env.production.local' });
const { Redis } = require('@upstash/redis');

async function getTelemetry() {
    try {
        const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        const data = await redis.get('debug_login_error');
        if (data) {
            console.log("=== TELEMETRY CAPTURED ===");
            console.log(JSON.stringify(data, null, 2));
        } else {
            console.log("No telemetry found. Are you sure the error triggered?");
        }
    } catch (e) {
        console.error("Redis fetch failed:", e);
    }
}
getTelemetry();
