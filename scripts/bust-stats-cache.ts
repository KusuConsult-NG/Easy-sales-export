/**
 * bust-stats-cache.ts — clears all cached cooperative stats keys from Redis
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/bust-stats-cache.ts
 */
import { deleteCache } from "../src/lib/cache-invalidation";

async function main() {
    const keys = [
        "admin:coop-stats:global",
        "admin:global-stats",
        "coop:members:all",
    ];
    console.log("\n🗑️  Busting cooperative stats caches...\n");
    for (const key of keys) {
        try {
            await deleteCache(key);
            console.log(`  ✅ Deleted: ${key}`);
        } catch (e: any) {
            console.log(`  ⚠️  Could not delete ${key}: ${e.message}`);
        }
    }
    console.log("\nDone. Dashboard will recompute fresh stats on next load.\n");
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
