import { config } from "dotenv";
config({ path: ".env.local" });
import { deleteCachePattern } from "../src/lib/redis";

async function main() {
    console.log("Clearing admin cache keys via Upstash...");
    await deleteCachePattern("admin:*");
    console.log("Cache cleared!");
}

main().catch(console.error);
