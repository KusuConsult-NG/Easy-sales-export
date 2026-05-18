import "dotenv/config";
import { invalidateAdminGlobalStats } from "../src/lib/cache-invalidation";
(async () => {
  await invalidateAdminGlobalStats();
  console.log("Cache busted");
  process.exit(0);
})();
