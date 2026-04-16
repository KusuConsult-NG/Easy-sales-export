import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { deleteCache, CacheKeys } from "./src/lib/redis";

async function clearCache() {
    const uid = "G7tQGmdl1ThZPsybhjcpnKrIlwB2"; // from previous check
    const key = CacheKeys.userProfile(uid);
    await deleteCache(key);
    console.log(`Cleared Redis profile cache for ${uid}`);

    // Let's also clear Next.js / Server Actions cache for good measure:
    const key2 = CacheKeys.userSession(uid);
    await deleteCache(key2);
    console.log(`Cleared Redis session cache for ${uid}`);
    
    const key3 = `user:*:${uid}`;
    const { deleteCachePattern } = await import("./src/lib/redis");
    await deleteCachePattern(key3);
    console.log(`Cleared Redis full pattern cache for ${uid}`);
}
clearCache().catch(console.error);
