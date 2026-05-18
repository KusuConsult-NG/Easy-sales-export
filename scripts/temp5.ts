import { config } from "dotenv";
config({ path: ".env.local" });
import { UserMetricsService } from "../src/services/userMetrics.service";

async function run() {
  const metrics = await UserMetricsService.getCooperativeMemberMetrics();
  console.log("Global metrics:", metrics);
}
run();
